// AI RACE mode's tech takeover (src/objects/ServerHalls.js) in the real level, in node: the
// planned slots (deterministic, clear of every protected spot, on dry walkable ground, wide
// corridors, the lawn still connected), the arrival schedule, the parked / active colliders,
// the hero never trapped (arrivals avoid him, a drop landing on him hurts him and pushes him
// out, a rising unit lifts him, a sinking one carries him down), sinking and reset, the terrain
// circuits, the draw-call budget, the sounds, the dust effect, the camera shake and the
// allocation rules of the hot paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Events } from '../src/core/events.js';
import { NO_WATER, PLAYER_HEIGHT, PLAYER_RADIUS } from '../src/core/constants.js';
import { makeRng } from '../src/core/math.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { ServerHalls, HALL, SLOT_RULES, planSlots, rectDistance, rectPointDistance, dropLift } from '../src/objects/ServerHalls.js';
import { HALL_TYPES } from '../src/objects/serverHallModel.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { MAX_CIRCUITS } from '../src/world/terrain.js';
import { SFX, SFX_INFO } from '../src/audio/sfx.js';
import { Effects } from '../src/fx/Effects.js';
import { KIND } from '../src/fx/kinds.js';
import { CameraShake } from '../src/camera/shake.js';

const scene = new THREE.Scene();
const level = buildLevel(scene);
const L = level.layout;
const col = level.collision;
const terrain = level.parts.find((p) => p.name === 'terrain');

// One ServerHalls for the file (each adds its colliders to the shared collision world); every
// test starts it cleared, with a fresh log.
const events = new Events();
const log = [];
events.on('sfx', (e) => log.push({ tick: halls?.tick ?? 0, name: e.name, pos: e.pos }));
events.on('hallImpact', (e) => log.push({ tick: halls?.tick ?? 0, name: 'hallImpact', ...e }));
const halls = new ServerHalls({ collision: col, events, level, layout: L, rng: makeRng(0x5e7e7) });
let clock = 0;

function reset() {
  halls.clear();
  log.length = 0;
}

// A stand-in hero far from every slot (the schedule tests).
function farHero() {
  return { pos: { x: 0, y: -5000, z: -30000 }, vel: { x: 0, y: 0, z: 0 }, action: 'idle', hits: [], takeDamage(n, from) {
    this.hits.push({ n, from });
    return true;
  } };
}

// Steps the halls (and the terrain clock) n ticks with `player`; each(i) after every tick.
function step(player, n = 1, each = null) {
  for (let i = 0; i < n; i++) {
    clock++;
    halls.update(player, clock);
    halls.animate(1, clock / 30);
    level.update(clock / 30);
    each?.(i);
  }
}

const inside = (u, x, z, shrink = 0) => rectPointDistance({ ...u, hw: u.hw - shrink, hd: u.hd - shrink }, x, z) === 0;

// Footprint sample points (grown by pad).
function samples(s, pad = 0, stepSize = 100) {
  const pts = [];
  const w = s.hw + pad;
  const d = s.hd + pad;
  for (let lx = -w; lx <= w + 1e-6; lx += (2 * w) / Math.ceil((2 * w) / stepSize)) {
    for (let lz = -d; lz <= d + 1e-6; lz += (2 * d) / Math.ceil((2 * d) / stepSize)) {
      pts.push({ x: s.x + lx * s.cos + lz * s.sin, z: s.z - lx * s.sin + lz * s.cos });
    }
  }
  return pts;
}

function segDist(px, pz, points) {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const t = Math.min(1, Math.max(0, ((px - a.x) * abx + (pz - a.z) * abz) / (abx * abx + abz * abz)));
    best = Math.min(best, Math.hypot(px - (a.x + abx * t), pz - (a.z + abz * t)));
  }
  return best;
}

// ---------------------------------------------------------------- planning

test('slots: 24-32 of them, all three unit types, planned deterministically, spreading out from the moat', () => {
  const slots = halls.slots;
  assert.ok(slots.length >= 24 && slots.length <= 32, `${slots.length} slots`);
  const count = { tower: 0, row: 0, hall: 0 };
  for (const s of slots) count[s.type]++;
  for (const t of Object.keys(count)) assert.ok(count[t] >= 5, `${count[t]} ${t}s`);
  // the same plan every time
  const again = planSlots(L, { collision: col, trees: level.trees });
  assert.deepEqual(again.map((s) => [s.type, s.x, s.z, s.yaw]), slots.map((s) => [s.type, s.x, s.z, s.yaw]));
  // arrival order: outward from the origin
  const d = slots.map((s) => Math.hypot(s.x - SLOT_RULES.ORIGIN.x, s.z - SLOT_RULES.ORIGIN.z));
  for (let i = 1; i < d.length; i++) assert.ok(d[i] >= d[i - 1] - 1e-6, 'sorted outward');
  const q = Math.floor(d.length / 4);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(d.slice(-q)) > mean(d.slice(0, q)) + 2500, 'the last ones far beyond the first ones');
  // sizes match the unit types
  for (const s of slots) {
    assert.equal(s.hw * 2, HALL_TYPES[s.type].w);
    assert.equal(s.hd * 2, HALL_TYPES[s.type].d);
  }
});

test('slots keep clear of the spawn, door, button, box, signs, trees, star, coins, 1-up and each other', () => {
  const near = (s, p, clear, what) => assert.ok(rectPointDistance(s, p.x, p.z) >= clear, `slot ${s.index} (${s.type}) within ${clear} of ${what}`);
  for (const s of halls.slots) {
    near(s, L.SPAWN, 1100, 'the spawn');
    near(s, { x: L.CASTLE.x, z: L.CASTLE.frontZ }, 1700, 'the castle door');
    near(s, L.AI_BUTTON, 750, 'the AI RACE button');
    near(s, L.MYSTERY_BOX, 800, 'the mystery box');
    near(s, L.STAR, 850, 'the star');
    for (const g of L.SIGNS) near(s, g, 500, `sign ${g.id}`);
    for (const t of level.trees) near(s, t, t.canopy.radius + 120, 'a tree and its canopy');
    for (const c of L.COINS) near(s, c, 280, 'a coin');
    for (const c of L.RED_COINS) near(s, c, 320, 'a red coin');
    near(s, L.ONE_UP ?? { x: L.CASTLE.x, z: L.CASTLE.backZ - 800 }, 600, 'the 1-up');
    // canopy volume: no unit under a canopy (the tallest unit is far below the canopies' tops
    // anyway, but nothing may stand under the leaves)
    for (const t of level.trees) assert.ok(rectPointDistance(s, t.canopy.x, t.canopy.z) > t.canopy.radius, 'under a canopy');
  }
  for (const a of halls.slots) {
    for (const b of halls.slots) {
      if (a !== b) assert.ok(rectDistance(a, b) >= SLOT_RULES.SPACING - 1e-6, `slots ${a.index} and ${b.index} ${rectDistance(a, b).toFixed(0)} apart`);
    }
  }
});

test('slots stand on dry, walkable, bare ground: off the paths, bridge, fences, water, cliffs and hills', () => {
  const B = L.BRIDGE;
  for (const s of halls.slots) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of samples(s)) {
      const region = L.regionAt(p.x, p.z);
      assert.ok(region === 'lawn' || region === 'island', `slot ${s.index} over ${region}`);
      assert.equal(L.waterLevelAt(p.x, p.z), NO_WATER, 'dry');
      assert.ok(L.sdWater(p.x, p.z) >= 300, 'clear of the moat and the pond');
      assert.ok(-L.sdRoundRect(p.x, p.z, L.PERIMETER) >= 600, 'clear of the cliffs');
      assert.ok(L.sdRoundRect(p.x, p.z, L.COURTYARD) > 500, 'off the courtyard');
      for (const path of L.PATHS) assert.ok(segDist(p.x, p.z, path.points) >= path.width / 2 + 200, `slot ${s.index} on a path`);
      for (const f of L.FENCES) assert.ok(segDist(p.x, p.z, f.points) >= 380, 'clear of the fences');
      assert.ok(!(Math.abs(p.x - B.x) < B.width / 2 + 300 && p.z > B.northZ - 300 && p.z < B.southZ + 300), 'clear of the bridge');
      const g = L.groundHeight(p.x, p.z);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
      // bare ground: the floor there is the terrain (no rock, bush, sign, fence, trunk ...)
      const f = col.findFloor(p.x, g + 400, p.z);
      assert.ok(f.surface && Math.abs(f.y - g) < 25, `slot ${s.index}: something stands at ${p.x.toFixed(0)},${p.z.toFixed(0)}`);
    }
    assert.ok(hi - lo <= SLOT_RULES.SLOPE + 1, `slot ${s.index} on a slope (${(hi - lo).toFixed(0)})`);
  }
});

test('with every unit out the lawn stays connected: every open spot reachable from the spawn still is', () => {
  const S = 100;
  const P = L.PERIMETER;
  const nx = Math.ceil((P.maxX - P.minX) / S);
  const nz = Math.ceil((P.maxZ - P.minZ) / S);
  const idx = (i, j) => j * nx + i;
  const at = (i, j) => ({ x: P.minX + (i + 0.5) * S, z: P.minZ + (j + 0.5) * S });
  const walk = new Uint8Array(nx * nz);
  const h = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const p = at(i, j);
      if (L.regionAt(p.x, p.z) !== 'lawn' || L.waterLevelAt(p.x, p.z) !== NO_WATER) continue;
      walk[idx(i, j)] = 1;
      h[idx(i, j)] = L.groundHeight(p.x, p.z);
    }
  }
  const blocked = (i, j) => halls.slots.some((s) => rectPointDistance(s, at(i, j).x, at(i, j).z) < PLAYER_RADIUS + 10);
  const reach = (withUnits) => {
    const seen = new Uint8Array(nx * nz);
    const si = Math.floor((L.SPAWN.x - P.minX) / S);
    const sj = Math.floor((L.SPAWN.z - P.minZ) / S);
    const queue = [[si, sj]];
    seen[idx(si, sj)] = 1;
    while (queue.length) {
      const [i, j] = queue.pop();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const k = idx(a, b);
        if (seen[k] || !walk[k] || Math.abs(h[k] - h[idx(i, j)]) > 70) continue;
        if (withUnits && blocked(a, b)) continue;
        seen[k] = 1;
        queue.push([a, b]);
      }
    }
    return seen;
  };
  const before = reach(false);
  const after = reach(true);
  let open = 0;
  let lost = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = idx(i, j);
      if (!before[k] || blocked(i, j)) continue;
      open++;
      if (!after[k]) lost++;
    }
  }
  assert.ok(open > 5000, `${open} open cells`);
  assert.equal(lost, 0, `${lost} open lawn cells cut off by the units`);
});

// ---------------------------------------------------------------- schedule

test('schedule: the first unit 4 s after the mode turns on, then one every few seconds, faster and faster, until all are out', () => {
  reset();
  const hero = farHero();
  halls.setMode(true);
  const starts = [];
  const styles = [];
  let t0 = clock;
  const seen = new Set();
  step(hero, 3000, () => {
    for (let i = 0; i < halls.units.length; i++) {
      const s = halls.stateOf(i);
      if (s !== 'idle' && !seen.has(i)) {
        seen.add(i);
        starts.push(clock - t0);
        styles.push(s);
      }
    }
  });
  assert.equal(starts[0], HALL.FIRST_DELAY, 'the first arrival');
  assert.equal(seen.size, halls.slots.length, 'every slot used');
  assert.equal(halls.outCount, halls.slots.length);
  const gaps = starts.slice(1).map((s, i) => s - starts[i]);
  assert.equal(gaps[0], HALL.EVERY);
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] <= gaps[i - 1] && gaps[i] >= HALL.EVERY_MIN, `gap ${i}: ${gaps[i]}`);
  assert.ok(gaps.at(-1) < gaps[0] * 0.6, 'accelerating');
  const total = starts.at(-1) / 30;
  assert.ok(total > 40 && total < 100, `all out after ${total.toFixed(0)} s`);
  // both styles, never more than two of one in a row, the first a drop
  assert.equal(styles[0], 'drop');
  assert.ok(styles.includes('drop') && styles.includes('rise'));
  for (let i = 2; i < styles.length; i++) assert.ok(!(styles[i] === styles[i - 1] && styles[i] === styles[i - 2]), 'three in a row');
  // planned order (nobody near any slot)
  const order = [...seen];
  assert.deepEqual(order, order.slice().sort((a, b) => a - b));
  // sounds: a warning per drop, a rise per rise, an impact per drop, the shake event
  assert.equal(log.filter((l) => l.name === 'hall_warn').length, styles.filter((s) => s === 'drop').length);
  assert.equal(log.filter((l) => l.name === 'hall_impact').length, styles.filter((s) => s === 'drop').length);
  assert.equal(log.filter((l) => l.name === 'hall_rise').length, styles.filter((s) => s === 'rise').length);
  assert.ok(log.filter((l) => l.name === 'hallImpact' && l.strength === 1 && l.kind === 'drop').length > 5);
  reset();
});

test('schedule and styles are deterministic for a seed', () => {
  const run = () => {
    const ev = new Events();
    const seq = [];
    ev.on('sfx', (e) => seq.push(e.name));
    const flat = { findFloor: () => ({ y: 0, surface: {} }), findWalls: (x, y, z) => ({ x, z, walls: [] }), waterLevelAt: () => NO_WATER };
    const h = new ServerHalls({ collision: flat, events: ev, slots: halls.slots, rng: makeRng(0x5e7e7) });
    h.setMode(true);
    const hero = farHero();
    for (let t = 1; t <= 2500; t++) h.update(hero, t);
    return seq.join(',');
  };
  assert.equal(run(), run());
});

test('no new arrival while a dialog holds the hero or he is dying / respawning', () => {
  reset();
  const hero = farHero();
  halls.setMode(true);
  for (let t = 0; t < HALL.FIRST_DELAY + 60; t++) {
    clock++;
    halls.update(hero, clock, true);
  }
  assert.equal(halls.outCount, 0, 'held');
  hero.action = 'death';
  step(hero, 60);
  assert.equal(halls.outCount, 0, 'dying');
  hero.action = 'idle';
  step(hero, HALL.RETRY + 1);
  assert.equal(halls.outCount, 1);
  reset();
});

// ---------------------------------------------------------------- colliders

const parked = (u) => u.surfaces.every((f) => f.maxY < -50000);

test('colliders wait parked far below the world, stand solid once a unit is up, and park again after it sinks', () => {
  reset();
  assert.ok(halls.units.every((u) => u.surfaces.length === 10), 'a top and four walls each');
  assert.ok(halls.units.every(parked), 'all parked');
  const hero = farHero();
  const u = halls.units[3];
  const g = L.groundHeight(u.x, u.z);
  assert.ok(Math.abs(col.findFloor(u.x, u.top + 100, u.z).y - g) < 25, 'only the ground under a parked unit');
  // a rise: the collider climbs with it, a tick ahead of the picture
  halls.arrive(3, 2);
  step(hero, HALL.RISE_TICKS + 2);
  assert.equal(halls.stateOf(3), 'on');
  assert.ok(Math.abs(col.findFloor(u.x, u.top + 10, u.z).y - u.top) < 1e-6, 'its top is a floor');
  // walls: a body next to it is pushed out; a ray from outside hits it
  const out = { x: u.x + (u.hw + 20) * u.cos, z: u.z - (u.hw + 20) * u.sin };
  const w = col.findWalls(out.x, g + 100, out.z, 0, PLAYER_RADIUS);
  assert.ok(w.walls.length > 0, 'wall push');
  assert.ok(rectPointDistance(u, w.x, w.z) >= PLAYER_RADIUS - 1, 'pushed clear');
  const hit = col.raycast({ x: u.x + 2000 * u.cos, y: g + 150, z: u.z - 2000 * u.sin }, { x: -u.cos, y: 0, z: u.sin }, 3000);
  assert.ok(hit && Math.abs(hit.distance - (2000 - u.hw)) < 2, 'a ray hits its wall');
  // a drop: parked while it falls, down a tick before the picture lands
  const v = halls.units[5];
  halls.arrive(5, 1);
  step(hero, HALL.WARN_TICKS - 2);
  assert.ok(parked(v), 'no collider in the air');
  step(hero, 1);
  assert.ok(!parked(v) && Math.abs(col.findFloor(v.x, v.top + 10, v.z).y - v.top) < 1e-6, 'landed collider');
  assert.ok(dropLift(HALL.WARN_TICKS - 1) > 0 && dropLift(HALL.WARN_TICKS) === 0);
  step(hero, 5);
  // the mode ends: both sink and park
  halls.setMode(false);
  step(hero, HALL.SINK_TICKS + 2);
  assert.equal(halls.outCount, 0);
  assert.ok(halls.units.every(parked), 'parked again');
  assert.ok(Math.abs(col.findFloor(u.x, u.top + 100, u.z).y - g) < 25);
  reset();
});

// ---------------------------------------------------------------- the hero

function hero(x, z, yaw = 0) {
  const p = new Player({ collision: col, events: new Events(), spawn: level.spawn });
  const f = col.findFloor(x, 1e5, z);
  p.teleport(x, f.y, z, yaw);
  p.setAction('idle');
  return p;
}

// Is the hero stuck inside unit u's box (below its top, overlapping its footprint)?
function trapped(p, u) {
  if (u.col < -10000) return false;
  const top = u.top + u.col;
  const base = u.base + u.col;
  return inside(u, p.pos.x, p.pos.z, 5) && p.pos.y < top - 80 && p.pos.y + PLAYER_HEIGHT > base;
}

test('an arrival never starts with the hero near its footprint', () => {
  reset();
  // The hero stands in the middle of each of the first slots in turn: the unit that comes goes
  // elsewhere.
  const p = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, action: 'idle', takeDamage: () => true };
  halls.setMode(true);
  const used = [];
  for (let k = 0; k < 6; k++) {
    const target = halls.units.find((u) => halls.stateOf(u.i) === 'idle');
    p.pos.x = target.x;
    p.pos.z = target.z;
    p.pos.y = L.groundHeight(target.x, target.z);
    const before = halls.outCount;
    for (let t = 0; t < 200 && halls.outCount === before; t++) step(p);
    const u = halls.units.find((w) => halls.stateOf(w.i) !== 'idle' && !used.includes(w.i));
    used.push(u.i);
    assert.notEqual(u.i, target.i, 'not the slot he stands on');
    assert.ok(rectPointDistance(u, p.pos.x, p.pos.z) >= HALL.SAFE, 'far from him');
  }
  // ... and it does not come where he is running to either
  const next = halls.units.find((u) => halls.stateOf(u.i) === 'idle');
  p.pos.x = next.x + 1500;
  p.pos.z = next.z;
  p.vel.x = -60; // there in 25 ticks
  const before = halls.outCount;
  for (let t = 0; t < 200 && halls.outCount === before; t++) step(p);
  assert.notEqual(halls.units.find((u) => halls.stateOf(u.i) !== 'idle' && !used.includes(u.i)).i, next.i);
  reset();
});

test('a drop landing on the hero hurts him 2 wedges (a fireball blast) and pushes him out of its footprint', () => {
  reset();
  for (const [k, where] of [[0, 'middle'], [7, 'near an edge']]) {
    const u = halls.units[k];
    const off = where === 'middle' ? 0 : u.hw - 30;
    const p = hero(u.x + off * u.cos, u.z - off * u.sin);
    const ctl = new ScriptedController();
    const h0 = p.health;
    halls.arrive(k, 1);
    let hurtAt = -1;
    for (let t = 0; t < HALL.WARN_TICKS + 30; t++) {
      p.update(ctl.next({}), 0);
      clock++;
      halls.update(p, clock);
      if (hurtAt < 0 && p.health < h0) hurtAt = t;
      assert.ok(!trapped(p, u), `trapped at tick ${t} (${where})`);
    }
    assert.equal(p.health, h0 - HALL.DAMAGE, `2 wedges (${where})`);
    assert.ok(hurtAt >= HALL.WARN_TICKS - 3, 'hit as it lands');
    assert.ok(rectPointDistance(u, p.pos.x, p.pos.z) >= PLAYER_RADIUS, `out of the footprint (${where})`);
    assert.ok(Math.abs(p.pos.y - L.groundHeight(p.pos.x, p.pos.z)) < 30, 'on the ground beside it');
    assert.equal(halls.stateOf(k), 'on');
  }
  assert.equal(halls.hits, 2);
  reset();
});

test('a falling unit sweeping through the hero in the air hits him too; one that misses does not', () => {
  reset();
  const u = halls.units[1];
  // A stand-in hero hanging 600 up over the footprint (flying): the unit passes through him.
  const p = { pos: { x: u.x, y: u.top + 600, z: u.z }, vel: { x: 0, y: 0, z: 0 }, action: 'fly', hits: [], takeDamage(n, from) {
    this.hits.push(n);
    return true;
  } };
  halls.arrive(1, 1);
  step(p, HALL.WARN_TICKS + 2);
  assert.deepEqual(p.hits, [HALL.DAMAGE]);
  assert.ok(rectPointDistance(u, p.pos.x, p.pos.z) > PLAYER_RADIUS);
  // Next to the footprint: untouched.
  const v = halls.units[2];
  const q = { pos: { x: v.x + (v.hw + PLAYER_RADIUS + 30) * v.cos, y: L.groundHeight(v.x, v.z), z: v.z - (v.hw + PLAYER_RADIUS + 30) * v.sin }, vel: { x: 0, y: 0, z: 0 }, action: 'idle', hits: [], takeDamage(n) {
    this.hits.push(n);
    return true;
  } };
  halls.arrive(2, 1);
  step(q, HALL.WARN_TICKS + 2);
  assert.deepEqual(q.hits, []);
  // No damage while a dialog holds him (he is still pushed out).
  const w = halls.units[4];
  const r = { pos: { x: w.x, y: L.groundHeight(w.x, w.z), z: w.z }, vel: { x: 0, y: 0, z: 0 }, action: 'reading', hits: [], takeDamage(n) {
    this.hits.push(n);
    return true;
  } };
  halls.arrive(4, 1);
  for (let t = 0; t < HALL.WARN_TICKS + 2; t++) {
    clock++;
    halls.update(r, clock, true);
  }
  assert.deepEqual(r.hits, []);
  assert.ok(rectPointDistance(w, r.pos.x, r.pos.z) > PLAYER_RADIUS);
  reset();
});

test('a unit rising under the hero lifts him onto its top; at its edge he is lifted or pushed out, never shut inside', () => {
  reset();
  for (const [k, off] of [[6, 0], [8, 1], [10, -1]]) {
    const u = halls.units[k];
    const d = off === 0 ? 0 : off * (u.hd - 25);
    const p = hero(u.x + d * u.sin, u.z + d * u.cos);
    const ctl = new ScriptedController();
    halls.arrive(k, 2);
    let lastY = p.pos.y;
    for (let t = 0; t < HALL.RISE_TICKS + 20; t++) {
      p.update(ctl.next({}), 0);
      clock++;
      halls.update(p, clock);
      assert.ok(!trapped(p, u), `trapped at tick ${t}`);
      assert.ok(Math.abs(p.pos.y - lastY) < 60, 'smoothly');
      lastY = p.pos.y;
    }
    const on = inside(u, p.pos.x, p.pos.z);
    if (off === 0) assert.ok(on && Math.abs(p.pos.y - u.top) < 1, `stands on its top (${p.pos.y.toFixed(0)} vs ${u.top.toFixed(0)})`);
    else assert.ok((on && Math.abs(p.pos.y - u.top) < 1) || rectPointDistance(u, p.pos.x, p.pos.z) >= PLAYER_RADIUS - 2, 'on top or outside');
  }
  reset();
});

test('the mode ends with the hero on a unit: it sinks and carries him down smoothly to the ground', () => {
  reset();
  const k = 9;
  const u = halls.units[k];
  const idle = farHero();
  halls.arrive(k, 2);
  step(idle, HALL.RISE_TICKS + 2);
  const p = new Player({ collision: col, events: new Events(), spawn: level.spawn });
  p.teleport(u.x, u.top, u.z, 0);
  p.setAction('idle');
  const ctl = new ScriptedController();
  const tick = () => {
    p.update(ctl.next({}), 0);
    clock++;
    halls.update(p, clock);
    level.update(clock / 30);
  };
  for (let t = 0; t < 5; t++) tick();
  assert.ok(Math.abs(p.pos.y - u.top) < 1, 'standing on it');
  assert.equal(terrain.circuits.live().length, 1, 'its circuit');
  halls.setMode(false);
  assert.ok(log.some((l) => l.name === 'hall_rise'), 'the sinking sound');
  let lastY = p.pos.y;
  for (let t = 0; t < HALL.SINK_TICKS + 10; t++) {
    tick();
    assert.ok(lastY - p.pos.y < 40 && p.pos.y <= lastY + 30, `smooth ride down (${lastY.toFixed(0)} -> ${p.pos.y.toFixed(0)})`);
    assert.ok(!trapped(p, u));
    assert.ok(p.action !== 'freefall' && p.action !== 'fall_damage', `no fall (${p.action})`);
    lastY = p.pos.y;
  }
  assert.equal(halls.stateOf(k), 'idle');
  assert.ok(parked(u));
  assert.ok(Math.abs(p.pos.y - L.groundHeight(p.pos.x, p.pos.z)) < 10, 'on the ground');
  for (let t = 0; t < 90; t++) tick();
  assert.equal(terrain.circuits.live().length, 0, 'its circuit faded away');
  reset();
});

test('a real hero chasing every arrival across the grounds is never shut inside a unit', () => {
  reset();
  const p = hero(L.SPAWN.x, L.SPAWN.z, Math.PI);
  p.takeDamage = function (n, from) {
    this.lastHit = n;
    return true; // no health lost: he keeps running
  };
  const ctl = new ScriptedController();
  halls.setMode(true);
  const rng = makeRng(99);
  let target = null;
  let yaw = Math.PI;
  let jumps = 0;
  let onTop = 0;
  let encounters = 0;
  for (let t = 0; t < 2600; t++) {
    // head for the unit arriving now (into drop zones, over rising units), else wander; as an
    // arrival starts he is put just outside it, on a random side, so he runs in under it
    const arriving = halls.units.find((u) => halls.stateOf(u.i) === 'drop' || halls.stateOf(u.i) === 'rise');
    if (arriving && arriving !== target) {
      const side = Math.floor(rng() * 4);
      const lx = side === 0 ? arriving.hw + 150 : side === 1 ? -arriving.hw - 150 : 0;
      const lz = side === 2 ? arriving.hd + 150 : side === 3 ? -arriving.hd - 150 : 0;
      const x = arriving.x + lx * arriving.cos + lz * arriving.sin;
      const z = arriving.z - lx * arriving.sin + lz * arriving.cos;
      const g = L.groundHeight(x, z);
      const f = col.findFloor(x, g + 200, z);
      if (f.surface && Math.abs(f.y - g) < 30 && L.waterLevelAt(x, z) === NO_WATER) {
        p.teleport(x, f.y, z, p.faceYaw);
        encounters++;
      }
    }
    if (arriving) target = arriving;
    if (target) yaw = Math.atan2(target.x - p.pos.x, target.z - p.pos.z);
    else if (t % 60 === 0) yaw = rng() * Math.PI * 2;
    const jump = t % 47 === 0;
    if (jump) jumps++;
    p.update(ctl.next({ stickY: 1, A: jump }), yaw);
    clock++;
    halls.update(p, clock);
    for (const u of halls.units) if (u.col === 0 && inside(u, p.pos.x, p.pos.z) && Math.abs(p.pos.y - u.top) < 2) onTop++;
    for (const u of halls.units) assert.ok(!trapped(p, u), `tick ${t}: trapped in slot ${u.i} (${halls.stateOf(u.i)}) at ${p.pos.x.toFixed(0)},${p.pos.y.toFixed(0)},${p.pos.z.toFixed(0)}`);
    if (p.action === 'death' || p.pos.y < -2000) assert.fail(`lost at tick ${t}`);
  }
  assert.ok(halls.outCount > 20, `${halls.outCount} out`);
  assert.ok(encounters > 15, `${encounters} encounters`);
  assert.ok(halls.hits > 0 && onTop > 0, `hit ${halls.hits} times, on top for ${onTop} ticks`);
  reset();
});

// ---------------------------------------------------------------- reset, circuits, render

test('reset: every unit gone at once, colliders parked, circuits cleared, nothing drawn', () => {
  reset();
  const h = farHero();
  halls.setMode(true);
  step(h, 900);
  assert.ok(halls.outCount >= 5);
  assert.ok(terrain.circuits.count >= 3, 'circuits on the ground');
  assert.ok(halls.mesh.children.some((m) => m.visible));
  halls.clear();
  halls.animate(1, clock / 30);
  assert.equal(halls.outCount, 0);
  assert.equal(halls.on, false);
  assert.ok(halls.units.every(parked));
  assert.equal(terrain.circuits.count, 0);
  assert.ok(halls.mesh.children.every((m) => !m.visible), 'no draw calls');
  // and nothing more arrives until the mode turns on again
  step(h, 300);
  assert.equal(halls.outCount, 0);
  reset();
});

test('terrain circuits: grow out to their radius, fade, clear; drawn by the ground materials (no mesh of their own)', () => {
  terrain.clearCircuits();
  const meshes = [];
  terrain.object3D.traverse((o) => o.isMesh && meshes.push(o.name));
  assert.ok(!meshes.includes('circuits') && meshes.length <= 10, `${meshes.length} terrain meshes`);
  let grass = null;
  terrain.object3D.traverse((o) => o.name === 'grass' && (grass = o));
  assert.match(grass.material.customProgramCacheKey(), /terrain-circuits/);
  const C = terrain.circuits;
  terrain.update(100);
  const id = level.addCircuit(1000, 3000, 900, { grow: 4 });
  assert.ok(id !== null);
  terrain.update(101);
  const u = C.uniforms.uCircuits.value[0];
  const r1 = u.z;
  terrain.update(104.5);
  assert.ok(u.z > r1 && Math.abs(u.z - 900) < 1, 'grown');
  assert.equal(C.uniforms.uCircuitCount.value, 1);
  level.fadeCircuit(id, 2);
  terrain.update(105.5);
  assert.equal(C.count, 1, 'fading');
  terrain.update(107);
  assert.equal(C.count, 0, 'gone');
  for (let i = 0; i < MAX_CIRCUITS + 3; i++) level.addCircuit(i * 100, 0, 300);
  assert.equal(C.count, MAX_CIRCUITS, 'a full pool reuses the oldest');
  level.clearCircuits();
  assert.equal(C.count, 0);
  assert.equal(C.uniforms.uCircuitCount.value, 0);
});

test('draw calls: at most three unit meshes and the markers, finite geometry; nothing while no unit is out', () => {
  reset();
  halls.animate(1, 0);
  let drawn = 0;
  halls.mesh.traverseVisible((o) => o.isMesh && o !== halls.mesh && o.count > 0 && drawn++);
  assert.equal(drawn, 0);
  const h = farHero();
  halls.setMode(true);
  let most = 0;
  let tris = 0;
  step(h, 3000, () => {
    let n = 0;
    let t = 0;
    halls.mesh.traverseVisible((o) => {
      if (!o.isMesh || !(o.count > 0)) return;
      n++;
      t += (o.geometry.attributes.position.count / 3) * o.count;
    });
    most = Math.max(most, n);
    tris = Math.max(tris, t);
  });
  assert.ok(most <= 4, `${most} draw calls`);
  assert.ok(tris < 50000, `${tris} triangles`);
  halls.mesh.traverse((o) => {
    if (o.isMesh) assert.ok(o.geometry.attributes.position.array.every(Number.isFinite), o.name);
  });
  reset();
});

test('ObjectManager: the takeover comes with the mode, goes with it, and reset() clears it', () => {
  const ev = new Events();
  const player = { pos: { x: 0, y: -5000, z: -30000 }, vel: { x: 0, y: 0, z: 0 }, action: 'idle', collectCoin() {}, collectStar() {}, takeDamage: () => true, getAttack: () => null };
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision: col, events: ev, layout: L, player, fx: null, level: { ...level, trees: level.trees } });
  const H = objects.halls;
  assert.ok(H && H.slots.length === halls.slots.length);
  ev.emit('darkMode', { on: true });
  for (let t = 0; t < HALL.FIRST_DELAY + 80; t++) {
    objects.update({ player });
    objects.animate(0, 1, null);
  }
  assert.ok(H.outCount >= 1);
  objects.reset();
  assert.equal(H.outCount, 0);
  assert.ok(H.units.every(parked));
});

test('ObjectManager: a unit taking its ground wrecks the minions there (no coin) and moves dropped coins out of it', () => {
  const ev = new Events();
  const player = { pos: { x: 0, y: -5000, z: -30000 }, vel: { x: 0, y: 0, z: 0 }, action: 'idle', collectCoin() {}, collectStar() {}, takeDamage: () => true, getAttack: () => null };
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision: col, events: ev, layout: L, player, fx: null, level: { ...level, trees: level.trees } });
  const H = objects.halls;
  const covered = (u, x, z) => H.near(u, x, z, 0);
  for (const [i, style] of [[0, 1], [1, 2]]) {
    const u = H.units[i];
    const m = objects.minions.spawnAt(u.x + 40, u.z - 30);
    const away = objects.minions.spawnAt(u.x + Math.hypot(u.hw, u.hd) + 400, u.z);
    assert.ok(m && away, 'minions placed');
    const coin = objects.spawnCoin(u.x - 50, u.planeY + 40, u.z + 20);
    assert.ok(coin && covered(u, coin.x, coin.z));
    assert.ok(H.arrive(i, style));
    for (let t = 0; t < 200 && H.stateOf(i) !== 'on'; t++) objects.update({ player });
    assert.equal(H.stateOf(i), 'on', `unit ${i} down`);
    assert.equal(m.state === 'wrecked' || m.state === 'vanish' || m.state === 'free', true, `the minion under it was wrecked (${m.state})`);
    assert.equal(m.drop, false, 'and drops no coin');
    assert.notEqual(away.state, 'wrecked', 'one outside the footprint is left alone');
    assert.ok(coin.alive, 'the coin is still there...');
    assert.ok(!H.near(u, coin.x, coin.z, 60), `...out of the footprint (${coin.x.toFixed(0)}, ${coin.z.toFixed(0)})`);
    const f = col.findFloor(coin.x, coin.y, coin.z);
    assert.ok(f.surface && coin.y - f.y > 20 && coin.y - f.y < 120, 'hovering over the floor there');
    objects.minions.clear();
  }
  objects.reset();
});

// ---------------------------------------------------------------- sound, fx, camera, rules

test('sounds: hall_warn, hall_impact and hall_rise exist with playback rules', () => {
  for (const n of ['hall_warn', 'hall_impact', 'hall_rise']) {
    assert.equal(typeof SFX[n], 'function', n);
    const info = SFX_INFO[n];
    assert.ok(info && info.range >= 2 && info.gap > 0 && info.max <= 3, n);
  }
});

test('fx.dust: dust billowing out of a footprint, sparks, debris and a ground ring', () => {
  const fx = new Effects({});
  fx.dust(0, 100, 0, { hw: 400, hd: 200, yaw: 0.5, radius: 300, count: 20, sparks: 10, debris: 5 });
  const n = {};
  for (let i = 0; i < fx.pool.count; i++) n[fx.pool.kind[i]] = (n[fx.pool.kind[i]] ?? 0) + 1;
  assert.equal(n[KIND.DUST], 20);
  assert.equal(n[KIND.SPARK], 10);
  assert.equal(n[KIND.DEBRIS], 5);
  assert.equal(n[KIND.SHOCKWAVE], 1);
  // the puffs start on the footprint's edge and fly outward
  for (let i = 0; i < fx.pool.count; i++) {
    if (fx.pool.kind[i] !== KIND.DUST) continue;
    const x = fx.pool.px[i];
    const z = fx.pool.pz[i];
    const lx = x * Math.cos(0.5) - z * Math.sin(0.5);
    const lz = x * Math.sin(0.5) + z * Math.cos(0.5);
    assert.ok(Math.abs(Math.abs(lx) - 400) < 1 || Math.abs(Math.abs(lz) - 200) < 1, 'on the edge');
    assert.ok(fx.pool.vx[i] * x + fx.pool.vz[i] * z > 0, 'outward');
  }
  for (let t = 0; t < 120; t++) fx.update(1 / 30, t / 30, null);
  assert.equal(fx.pool.count, 0, 'settled after 4 s');
});

test('camera shake: a nearby impact jolts the view, a far one barely, and it dies away (frozen while paused)', () => {
  const ev = new Events();
  const shake = new CameraShake(ev);
  const cam = new THREE.PerspectiveCamera();
  const look = () => {
    cam.position.set(0, 300, 0);
    cam.lookAt(0, 300, -1000);
    return cam.quaternion.clone();
  };
  const q0 = look();
  ev.emit('hallImpact', { pos: { x: 0, y: 0, z: -800 }, strength: 1 });
  let moved = 0;
  for (let i = 0; i < 6; i++) {
    look();
    shake.apply(cam, 1 / 60);
    moved = Math.max(moved, cam.quaternion.angleTo(q0));
  }
  assert.ok(moved > 0.002 && moved < 0.03, `jolt ${moved}`);
  look();
  const a = shake.amount;
  shake.apply(cam, 0);
  assert.equal(shake.amount, a, 'paused: frozen');
  for (let i = 0; i < 120; i++) {
    look();
    shake.apply(cam, 1 / 60);
  }
  assert.ok(shake.amount < 0.01, 'died away');
  shake.amount = 0;
  ev.emit('hallImpact', { pos: { x: 0, y: 0, z: -20000 }, strength: 1 });
  look();
  shake.apply(cam, 1 / 60);
  assert.ok(cam.quaternion.angleTo(q0) < 1e-6, 'too far to feel');
});

test('server hall hot paths avoid allocating constructs', () => {
  const P = ServerHalls.prototype;
  const hot = ['update', 'animate', '_pickSlot', '_stepDrop', '_stepRise', '_stepOn', '_stepSink', '_setCollider', 'near', '_inBody', '_clods', 'gapAfter'];
  for (const name of hot) {
    const src = P[name].toString();
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, name);
    assert.doesNotMatch(src, /\.(map|filter|forEach|reduce|some|find|sort)\(/, name);
  }
});
