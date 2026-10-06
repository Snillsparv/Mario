// Areas whose code loads lazily (core/AreaSwitch.js load, world/areaDefs.js def.code: each area's
// code a chunk of its own, src/core/chunks.js), in node with the real grounds, Jonas and the
// camera: a request for an area whose code is not in yet is accepted (its entries are in main);
// walking into the castle door the wipe closes, then holds the covered screen (the stick neutral)
// for as long as the hall's code is on its way; once it is in, the next tick switches, and he
// arrives exactly as with the code there from the start. A load that fails opens the wipe again
// without switching (logged once), the door re-arms once he steps off it and the next try loads
// again; one that never answers gives up after WARP.LOAD_WAIT ticks the same way. load() itself:
// true once get() can build the area, false for an unknown one or a failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Events } from '../src/core/events.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { CameraController } from '../src/camera/CameraController.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { AreaSwitch, WARP } from '../src/core/AreaSwitch.js';
import { AREA_DEFS as LAZY } from '../src/world/areaDefs.js';
import { AREA_DEFS as EAGER } from '../src/world/areas.js';
import * as hallCode from '../src/world/hall/index.js';

// The lazy defs with the hall's code given by `code` (a stand-in for its chunk's loader).
const lazyDefs = (code) => ({ ...LAZY, hall: { ...LAZY.hall, code } });

// A stand-in chunk: code() returns a promise this test settles (resolve / reject), counting calls.
function deferredCode() {
  const c = { calls: 0 };
  c.code = () => {
    c.calls++;
    return new Promise((resolve, reject) => {
      c.resolve = () => resolve(hallCode);
      c.reject = () => reject(new Error('offline'));
    });
  };
  return c;
}

// The game as main wires it, for the castle door: the real grounds and their objects, Jonas, the
// camera, stand-ins for the renderer, HUD and input; tick() is main's tick in play.
function game(defs) {
  const scene = new THREE.Scene();
  const level = buildLevel(scene);
  const events = new Events();
  const player = new Player({ collision: level.collision, events, spawn: level.spawn });
  const cam = new CameraController({ collision: level.collision, camera: new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000), events });
  const objects = new ObjectManager({ scene, collision: level.collision, events, layout: level.layout, player, level });
  const view = { scene, setAtmosphere() {}, setWaterLevelFn() {}, prewarm() {} };
  const log = [];
  events.on('warpRequest', (e) => log.push(`warp:${e.to}`));
  const arrivals = [];
  const areas = new AreaSwitch({ scene, view, events, input: { flush() {} }, player, cam, hud: null, dialog: { isOpen: false }, defs, grounds: { level, objects } });
  events.on('areaChange', (e) => {
    log.push(`area:${e.to}`);
    arrivals.push({ entry: e.entry, pos: { ...player.pos }, faceYaw: player.faceYaw, cam: cam.pos.toArray() });
  });
  const ctl = new ScriptedController();
  const phases = [];
  const sticks = [];
  const wipes = [];
  const tick = (input = {}) => {
    phases.push(areas.phase);
    const c = areas.step(ctl.next(input));
    sticks.push(c.stickMag);
    player.update(cam.playerInput(c), cam.getYaw());
    areas.objects.update({ player, frame: 0, camera: cam, warping: areas.busy });
    cam.update(c, player);
    wipes.push(areas.wipe(1).amount);
  };
  const until = (pred, n, input) => {
    let i = 0;
    while (i < n && !pred()) {
      tick(input);
      i++;
    }
    return i;
  };
  // Up the porch steps into the castle door, until it asks for the warp.
  const walkIn = () => {
    player.teleport(0, 300, -300, Math.PI);
    player.setAction('idle');
    cam.reset(player);
    until(() => log.includes('warp:hall'), 90, { stickY: 1 });
    assert.equal(areas.phase, 'close');
    phases.length = sticks.length = wipes.length = 0;
  };
  return { player, cam, objects, areas, log, arrivals, phases, sticks, wipes, tick, until, walkIn };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// [[value, how many in a row], ...]
function runs(list) {
  const out = [];
  for (const v of list) {
    if (out.length && out.at(-1)[0] === v) out.at(-1)[1]++;
    else out.push([v, 1]);
  }
  return out;
}

// Console warnings during fn (and fn's result).
async function warnings(fn) {
  const was = console.warn;
  const out = [];
  console.warn = (...a) => out.push(a.join(' '));
  try {
    await fn();
  } finally {
    console.warn = was;
  }
  return out;
}

test('the castle door into a hall whose code is still loading: the wipe closes and holds, covered and still, until it is in; then he arrives as with the code there from the start', async () => {
  const eager = game(EAGER);
  eager.walkIn();
  eager.until(() => eager.areas.phase === null, 60);

  const c = deferredCode();
  const g = game(lazyDefs(c.code));
  assert.equal(g.areas.get('hall'), null, 'not built: its code is not in');
  g.walkIn();
  const WAIT = 40;
  for (let i = 0; i < WARP.CLOSE + WAIT; i++) g.tick();
  assert.equal(c.calls, 1, 'its code asked for once');
  assert.deepEqual(runs(g.phases), [['close', WARP.CLOSE], ['hold', WAIT]]);
  assert.equal(g.areas.name, 'grounds');
  assert.ok(g.sticks.slice(WARP.CLOSE).every((m) => m === 0), 'the stick neutral meanwhile');
  assert.ok(g.wipes.slice(WARP.CLOSE - 1).every((a) => a === 1), 'the screen covered meanwhile');
  assert.equal(g.areas.wipe(0.5).amount, 1);

  c.resolve();
  await settle();
  g.until(() => g.areas.phase === null, 60);
  assert.deepEqual(runs(g.phases), [['close', WARP.CLOSE], ['hold', WAIT + WARP.HOLD], ['open', WARP.OPEN]]);
  assert.deepEqual(g.log.filter((l) => l.startsWith('area:')), ['area:hall']);
  assert.equal(g.areas.name, 'hall');
  assert.deepEqual(g.arrivals, eager.arrivals, 'the same arrival');
  assert.deepEqual(g.player.pos, eager.player.pos, 'the same walk in');
  assert.equal(c.calls, 1);
});

test('a hall whose code fails to load: the wipe opens again on the porch without switching (logged once); the door re-arms off its apron and the next try loads again', async () => {
  const c = deferredCode();
  const g = game(lazyDefs(c.code));
  g.walkIn();
  for (let i = 0; i < WARP.CLOSE + 5; i++) g.tick();
  const logged = await warnings(async () => {
    c.reject();
    await settle();
    g.until(() => g.areas.phase === null, 60);
  });
  assert.equal(logged.length, 1, logged.join('\n'));
  assert.match(logged[0], /hall: its code did not load \(offline\)/);
  assert.deepEqual(runs(g.phases).map(([p]) => p), ['close', 'hold', 'open']);
  assert.equal(g.areas.name, 'grounds', 'still on the porch');
  assert.ok(!g.log.some((l) => l.startsWith('area:')), 'no switch');
  assert.equal(g.wipes.at(-1), 0, 'the picture open again');
  assert.ok(g.player.pos.z > -700 && g.player.pos.y > 200, 'at the castle door');
  assert.equal(g.objects.door.armed, false, 'the door quiet while he stands at it');

  // Off its apron and back in: the code is asked for again, and this time it comes.
  g.until(() => g.objects.door.armed, 120, { stickY: -1 });
  assert.equal(g.objects.door.armed, true);
  g.log.length = 0;
  g.walkIn();
  for (let i = 0; i < WARP.CLOSE + 3; i++) g.tick();
  assert.equal(c.calls, 2, 'loaded again');
  c.resolve();
  await settle();
  g.until(() => g.areas.phase === null, 60);
  assert.equal(g.areas.name, 'hall');
});

test('a hall whose code never answers: after WARP.LOAD_WAIT ticks covered the wipe opens again without switching', () => {
  const g = game(lazyDefs(() => new Promise(() => {})));
  g.walkIn();
  g.until(() => g.areas.phase === 'open', WARP.CLOSE + WARP.LOAD_WAIT + 5);
  assert.deepEqual(runs(g.phases), [['close', WARP.CLOSE], ['hold', WARP.LOAD_WAIT + 1]]);
  g.until(() => g.areas.phase === null, 60);
  assert.equal(g.areas.name, 'grounds');
  assert.ok(WARP.LOAD_WAIT >= 300, 'a slow network gets its time');
});

test("load(): true once get() can build the area (the eager defs' at once), false for an unknown area or a failure; requests are accepted before the code is in", async () => {
  let fail = true;
  const g = game(lazyDefs(() => (fail ? Promise.reject(new Error('404')) : Promise.resolve(hallCode))));
  assert.equal(await g.areas.load('grounds'), true);
  assert.equal(await g.areas.load('nowhere'), false);
  const logged = await warnings(async () => assert.equal(await g.areas.load('hall'), false));
  assert.equal(logged.length, 1);
  assert.equal(g.areas.get('hall'), null);
  fail = false;
  const [a, b] = [g.areas.load('hall'), g.areas.load('hall')];
  assert.equal(a, b, 'one load at a time');
  assert.equal(await a, true);
  const hall = g.areas.get('hall');
  assert.ok(hall && hall.name === 'hall' && hall.def.builders === hallCode.builders);
  assert.equal(await g.areas.load('hall'), true);
  // The courses' entries are known before their code is in (main holds every layout).
  const h = game(LAZY);
  assert.equal(h.areas._hasEntry('skerries', 'arrival'), true);
  assert.equal(h.areas._hasEntry('lane', 'nowhere'), false);
  assert.equal(h.areas.request({ to: 'lane', entry: LAZY.lane.respawn.entry, kind: 'leave' }), true);
  const eager = game(EAGER);
  assert.equal(await eager.areas.load('skerries'), true, "world/areas.js's defs carry their code");
  assert.ok(eager.areas.get('skerries').objects.critters, "the course's critters (Critters.js registered itself)");
});
