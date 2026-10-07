// AI RACE's objects attached late (objects/aiRace.js, the lazy chunk `aiRace`; ObjectManager
// attachAiRace), in node on the real grounds: a manager built before the kit is in has no beast,
// fire, fireballs, minions, server halls or boss star (and nothing breaks: ticks, frames, a
// reset); attachAiRace() then makes them exactly as a manager built with the kit there: the same
// planned hall slots, beast anchor, shadow slots, collider surfaces (the parked halls' included)
// and group order, the tail grip handed to the hero; and run through 600 ticks of AI RACE with
// Jonas on the lawn, the two play out the same, tick for tick. Attached after a title's worth of
// ambient ticks, the plan and the kit's colliders are still the same. A layout without KAIJU attaches
// nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Events } from '../src/core/events.js';
import { FRAME_DT } from '../src/core/constants.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { KINDS } from '../src/objects/kinds.js';
import '../src/objects/aiRace.js';

// The grounds with their objects: the kit there from the start, or (late) attached afterwards.
function grounds({ late = false, ambient = 0 } = {}) {
  const scene = new THREE.Scene();
  const level = buildLevel(scene);
  const events = new Events();
  const player = new Player({ collision: level.collision, events, spawn: level.spawn });
  const kit = KINDS.aiRace;
  if (late) delete KINDS.aiRace;
  let objects;
  let kitFrom = -1; // (late: the first surface the kit's colliders took)
  try {
    objects = new ObjectManager({ scene, collision: level.collision, events, layout: level.layout, player, fx: null, level });
  } finally {
    KINDS.aiRace = kit;
  }
  if (late) {
    assert.equal(objects.beast, null);
    for (let i = 0; i < ambient; i++) objects.animate(i * FRAME_DT, 1, null);
    kitFrom = level.collision.surfaces.length;
    assert.equal(objects.attachAiRace(), true);
  }
  const log = [];
  for (const name of ['sfx', 'fireball', 'hallImpact', 'minionSpawn', 'lifeLost', 'coin']) events.on(name, (e) => log.push([name, e?.name ?? '', JSON.stringify(e?.pos ?? null)]));
  return { level, events, player, objects, log, kitFrom };
}

// Every surface of the collision world, rounded (order included).
const surfaces = (collision) => collision.surfaces.map((s) => [...(s.a ?? []), ...(s.b ?? []), ...(s.c ?? []), s.terrain ?? '', s.kind].map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)).join(','));

test('without the kit the grounds have no AI RACE objects, and run, draw and reset as ever', () => {
  const g = grounds({ late: true, ambient: 0 });
  const kit = KINDS.aiRace;
  delete KINDS.aiRace;
  let bare;
  try {
    const scene = new THREE.Scene();
    bare = new ObjectManager({ scene, collision: g.level.collision, events: new Events(), layout: g.level.layout, player: g.player, fx: null, level: g.level });
  } finally {
    KINDS.aiRace = kit;
  }
  for (const k of ['beast', 'fire', 'fireballs', 'minions', 'halls', 'bossStar']) assert.equal(bare[k], null, k);
  for (let t = 0; t < 30; t++) bare.update({ player: g.player });
  bare.animate(1, 1, null);
  bare.setDarkness(0.5);
  bare.reset();
  assert.equal(bare.attachAiRace(), true, 'the kit is in now: attached');
  assert.ok(bare.beast && bare.halls && bare.minions && bare.bossStar);
});

test("attached late, AI RACE's objects are what they would have been: slots, anchor, shadows, colliders, group order, the tail grip", () => {
  const a = grounds();
  const b = grounds({ late: true });
  assert.deepEqual(b.objects.halls.slots, a.objects.halls.slots, 'the planned hall slots');
  assert.deepEqual([b.objects.beast.x, b.objects.beast.baseY, b.objects.beast.z, b.objects.beast.yaw], [a.objects.beast.x, a.objects.beast.baseY, a.objects.beast.z, a.objects.beast.yaw], 'the beast on its roof');
  assert.equal(b.objects.minions.shadowBase, a.objects.minions.shadowBase, "the minions' shadow slots");
  assert.equal(b.objects.bossStar.shadowSlot, a.objects.bossStar.shadowSlot, "the boss star's");
  assert.equal(b.objects.shadows.mesh.count, a.objects.shadows.mesh.count, 'as many shadow slots');
  assert.deepEqual(surfaces(b.level.collision), surfaces(a.level.collision), 'the same collider surfaces, in the same order');
  assert.deepEqual(b.objects.group.children.map((c) => c.name), a.objects.group.children.map((c) => c.name), 'the group in the same order');
  assert.equal(b.player.tailGrip, b.objects.beast.grip, 'his grip on its tail');
  assert.equal(b.objects.attachAiRace(), true, 'attached once');
  assert.equal(b.objects.group.children.length, a.objects.group.children.length);
});

test('attached late, 600 ticks of AI RACE with Jonas on the lawn play out the same, tick for tick', () => {
  const runs = [grounds(), grounds({ late: true })].map((g) => {
    const ctl = new ScriptedController();
    g.player.teleport(1800, 400, 2600, Math.PI);
    g.player.setAction('idle');
    g.events.emit('darkMode', { on: true });
    const trace = [];
    for (let t = 0; t < 600; t++) {
      const c = ctl.next(t % 90 < 45 ? { stickX: 0.6, stickY: 0.4 } : { stickX: -0.5, stickY: -0.3, A: t % 30 === 0 });
      g.player.update(c, 0);
      g.objects.update({ player: g.player });
      g.objects.animate(t * FRAME_DT, 1, null);
      if (t % 20 === 0) {
        const o = g.objects;
        trace.push([
          t,
          o.beast.state,
          Math.round(o.beast.yaw * 1000),
          o.fireballs.balls?.filter?.((x) => x.alive).length ?? null,
          o.minions.alive,
          o.halls.units.map((u) => u.state).join(''),
          Math.round(g.player.pos.x),
          Math.round(g.player.pos.z),
          g.player.health,
        ]);
      }
    }
    return { trace, log: g.log };
  });
  assert.deepEqual(runs[1].trace, runs[0].trace);
  assert.deepEqual(runs[1].log, runs[0].log, 'the same sounds, impacts and spawns');
  assert.ok(runs[0].trace.some((r) => r[1] === 'active'), 'the beast rose');
});

test('attached after a title of ambient ticks: the same plan and colliders; a layout without KAIJU attaches nothing', () => {
  const a = grounds();
  const b = grounds({ late: true, ambient: 240 });
  assert.ok(b.objects.tick > 0, 'ambient ticks ran first');
  assert.deepEqual(b.objects.halls.slots, a.objects.halls.slots);
  // (The box bobs, its collider with it: the surfaces' count and the ones the kit added match.)
  const [sa, sb] = [surfaces(a.level.collision), surfaces(b.level.collision)];
  assert.equal(sb.length, sa.length);
  const added = sa.length - b.kitFrom;
  assert.ok(added > 0, 'the parked halls add colliders');
  assert.deepEqual(sb.slice(b.kitFrom), sa.slice(b.kitFrom), "the kit's colliders");
  const scene = new THREE.Scene();
  const course = new ObjectManager({ scene, collision: a.level.collision, events: new Events(), layout: { COINS: [], groundHeight: () => 0 }, player: a.player, area: 'hall' });
  assert.equal(course.attachAiRace(), false);
  assert.equal(course.beast, null);
});
