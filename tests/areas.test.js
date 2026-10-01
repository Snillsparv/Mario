// Areas in node (core/AreaSwitch.js, world/area.js, world/areas.js) with the real grounds and
// their objects, the real Great Hall, the real Player and CameraController, and main's tick:
// walking up the porch steps into the castle door creaks it open (no laugh) and asks for the
// warp once; the wipe closes (14 ticks, Jonas pushing on toward the door), holds (4, the
// switch on the first) and opens (14) with one switch; nothing reachable from Jonas or the
// camera then holds any collision world but the hall's (the grounds' again after the way
// back); the renderer got the hall's look and water; he stands at the front entry with the
// camera behind him, clear, inside the room. Walking back toward the camera to the inner door,
// the camera cuts round to the room side as he nears it (never close over him at the wall) and
// the stick he holds walks him on into the door, so the wipe closes on him at the door (only
// for a door behind the camera that leads somewhere). The inner door takes him back onto the porch
// facing out with the camera in front of him; the castle door re-arms as he walks out and
// takes him in again. AI RACE (on, or still fading out) seals the door: the laugh and the
// castle_sealed sign, no warp. A refused warp leaves the door quiet until he has stepped off
// its apron; dying while the wipe closes opens it again without a switch, and so does a warp
// no longer allowed once the screen is covered (AI RACE switched on during close);
// enter('grounds', 'start') brings back the grounds' spawn, signs and collision. A stick held
// through the inner door walks him on out across the camera cut instead of back in (until it
// is let go or turned). A small course of our own (a placed star, a star exit, a way out from
// the pause screen) shows the star exit waiting out the dance and fading to gold-white,
// leave(), refused requests, and resetCourses() taking the star back; another, whose arrival
// stands in a door, shows every switch keeping that door quiet (objects.enter). The hall's
// east doors (not open yet) show their sign, without a laugh or a warp. Midsummer Skerries, the
// first course: up the stairs into the bottle's neck (its own sound, the iris) he drops in onto
// the jetty from the sky with the camera behind him and the course's look, and its card shows
// on the first entry of a game only; the star (on the lighthouse gallery) takes him back out of
// the bottle exactly 20 ticks after his dance (popping out with its sound), stays taken when he
// comes back, and a stick held on through the exit waits to be let go (then a fresh push walks
// him straight back into the armed bottle); so does the pause screen's leave (main's paused
// branch: B, then unpause, then leave()), which is open while he reads a sign (it closes) but
// not while he drops in or dies, so the pause screen offers it only then; a life lost there
// drops him back in at the arrival; GAME OVER (main's order: the grounds back before the
// resets and the title) gives the course its star, its coins and its dark lamp back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Events } from '../src/core/events.js';
import { stickToWorldYaw, wrapAngle } from '../src/core/math.js';
import { NO_WATER } from '../src/core/constants.js';
import { neutralController } from '../src/core/input.js';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { CameraController } from '../src/camera/CameraController.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { DOOR } from '../src/objects/Door.js';
import { AreaSwitch, WARP } from '../src/core/AreaSwitch.js';
import { readFileSync } from 'node:fs';
import { AREA_DEFS, HALL_ATMOSPHERE, SKERRIES_ATMOSPHERE } from '../src/world/areas.js';
import { buildArea, shiftPositions } from '../src/world/area.js';
import { SolidBuilder } from '../src/world/castle/geom.js';
import * as hall from '../src/world/hall/layout.js';
import * as sk from '../src/world/skerries/layout.js';

const HALL_Z = AREA_DEFS.hall.origin.z;
const SK = AREA_DEFS.skerries.origin; // Midsummer Skerries: world = local + SK
const PORCH = { x: 0, y: 300, z: -470 }; // the grounds' porch entry, measured on the real level

// The game as main wires it: the real grounds and their objects, Jonas, the camera, and
// stand-ins for the renderer (what it was told), the HUD, the dialog box and the input.
function game(defs = AREA_DEFS) {
  const scene = new THREE.Scene();
  const level = buildLevel(scene);
  const events = new Events();
  const player = new Player({ collision: level.collision, events, spawn: level.spawn });
  const cam = new CameraController({ collision: level.collision, camera: new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000), events });
  const objects = new ObjectManager({ scene, collision: level.collision, events, layout: level.layout, player, level });
  const view = { scene, looks: [], water: null, warm: [] };
  view.setAtmosphere = (preset) => view.looks.push(preset);
  view.setWaterLevelFn = (fn) => (view.water = fn);
  view.prewarm = (o) => view.warm.push(o);
  const hud = { course: 'grounds', cards: [] };
  hud.setCourse = (name) => (hud.course = name);
  hud.showCourse = (name) => hud.cards.push(name);
  // The dialog box: open on a sign, its close() ending the read as main's 'dialogClosed' does.
  const dialog = { isOpen: false };
  dialog.close = () => {
    if (!dialog.isOpen) return;
    dialog.isOpen = false;
    events.emit('dialogClosed', { cancelled: true });
  };
  events.on('dialogClosed', () => player.endReading());
  const input = { flushes: 0, flush: () => input.flushes++ };
  const state = { ok: true };
  const log = [];
  const arrivals = []; // Jonas and the camera as each switch left them
  events.on('sfx', (e) => log.push(e.name));
  events.on('warpRequest', (e) => log.push(`warp:${e.to}`));
  events.on('signRead', (e) => {
    log.push(`sign:${e.sign.id}`);
    dialog.isOpen = true;
  });
  let lastAction = player.action;
  const areas = new AreaSwitch({
    scene,
    view,
    events,
    input,
    player,
    cam,
    hud,
    dialog,
    defs,
    grounds: { level, objects },
    canWarp: () => state.ok,
    onSwap: () => (lastAction = player.action),
  });
  events.on('areaChange', (e) => {
    log.push(`area:${e.to}`);
    arrivals.push({ ...e, pos: { ...player.pos }, faceYaw: player.faceYaw, action: player.action, grounded: player.grounded, cam: cam.pos.clone(), occluded: cam.collider.occluded });
  });
  const resets = []; // the phase each camera reset came in
  const reset = cam.reset.bind(cam);
  cam.reset = (...args) => (resets.push(areas.phase), reset(...args));
  const ctl = new ScriptedController();
  const phases = []; // the phase each tick's step ran in
  const sticks = []; // the stick step gave Jonas each tick: { yaw (world), mag }
  const wipes = []; // the wipe after each tick
  // One tick of main's tick() in play.
  const tick = (input = {}) => {
    let c = ctl.next(typeof input === 'function' ? input() : input);
    if (dialog.isOpen) c = neutralController();
    phases.push(areas.phase);
    c = areas.step(c);
    sticks.push({ yaw: stickToWorldYaw(c.stickX, c.stickY, cam.getYaw()), mag: c.stickMag });
    player.update(cam.playerInput(c), cam.getYaw());
    if (player.action !== lastAction) lastAction = player.action;
    areas.objects.update({ player, frame: 0, camera: cam });
    cam.update(c, player);
    wipes.push(areas.wipe(1).amount);
  };
  // Ticks until pred() (at most n); returns how many ran.
  const until = (pred, n, input) => {
    let i = 0;
    while (i < n && !pred()) {
      tick(input);
      i++;
    }
    return i;
  };
  // The stick toward world yaw `yaw` for the camera's current yaw.
  const toward = (yaw) => () => {
    const a = wrapAngle(cam.getYaw() - yaw);
    return { stickX: Math.sin(a), stickY: Math.cos(a) };
  };
  const place = (x, y, z, yaw) => {
    player.teleport(x, y, z, yaw);
    player.setAction('idle');
    cam.reset(player);
  };
  return { level, events, player, cam, objects, view, hud, dialog, input, state, log, arrivals, resets, phases, sticks, wipes, areas, tick, until, toward, place };
}

// Every CollisionWorld reachable from `root` through own enumerable properties (not through
// three.js objects, event hubs, typed arrays or functions).
function worldsIn(...roots) {
  const found = new Set();
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v instanceof CollisionWorld) {
      found.add(v);
      return;
    }
    if (v.isObject3D || v.isVector3 || v instanceof Events || ArrayBuffer.isView(v)) return;
    for (const k of Object.keys(v)) walk(v[k]);
  };
  for (const r of roots) walk(r);
  return [...found];
}

// [[value, how many in a row], ...]
function runs(list) {
  const out = [];
  for (const v of list) {
    if (out.length && out.at(-1)[0] === v) out.at(-1)[1]++;
    else out.push([v, 1]);
  }
  return out;
}

const count = (log, name) => log.filter((n) => n === name).length;

// A star just taken: ticks until the star exit's fade starts. Returns the tick Jonas first went
// into out of his dance (star_dance / star_fall) and the tick the fade started on.
function danceThenFade(g, n = 200) {
  let out = -1;
  let i = 0;
  for (; i < n && g.areas.phase !== 'close'; i++) {
    if (out < 0 && !['star_dance', 'star_fall'].includes(g.player.action)) out = i;
    g.tick();
  }
  return { out, fade: i - 1 };
}

// The sticks given while the wipe closed all push fully toward world yaw `yaw`.
function pushedToward(g, yaw) {
  const close = g.sticks.filter((_, i) => g.phases[i] === 'close');
  assert.equal(close.length, WARP.CLOSE);
  for (const s of close) {
    assert.equal(s.mag, 1);
    assert.ok(Math.abs(wrapAngle(s.yaw - yaw)) < 1e-9, `pushed toward ${s.yaw}, not ${yaw}`);
  }
}

test('into the castle: the door creaks, the wipe closes 14, holds 4 (one switch) and opens 14; Jonas in the hall', () => {
  const g = game();
  g.place(0, 300, -300, Math.PI);
  g.resets.length = 0;
  g.until(() => g.log.includes('warp:hall'), 90, { stickY: 1 });
  assert.equal(count(g.log, 'warp:hall'), 1, g.log.join());
  assert.ok(g.log.includes('door_open'));
  assert.ok(!g.log.includes('evil_laugh') && !g.log.some((n) => n.startsWith('sign:')), 'no laugh, no message');
  assert.equal(g.areas.phase, 'close');
  g.phases.length = 0;
  g.sticks.length = 0;
  g.wipes.length = 0;
  // Jonas pushes on toward the door while it closes (no stick of his own given).
  const zs = [];
  const ticks = g.until(() => g.areas.phase === null, 40, () => (zs.push(g.player.pos.z), {}));
  assert.ok(ticks <= 40);
  assert.deepEqual(runs(g.phases), [['close', WARP.CLOSE], ['hold', WARP.HOLD], ['open', WARP.OPEN]]);
  assert.equal(count(g.log, 'area:hall'), 1, 'exactly one switch');
  assert.ok(zs[WARP.CLOSE - 1] <= zs[0], 'toward the door, not away');
  pushedToward(g, g.objects.door.yaw + Math.PI);
  assert.deepEqual(g.resets, ['hold'], 'the camera behind him already: no cut until the switch');
  // Covered: the stick neutral; opening: walking in north along the entry's yaw.
  assert.ok(g.sticks.slice(WARP.CLOSE, WARP.CLOSE + WARP.HOLD).every((s) => s.mag === 0));
  const walkIn = g.sticks.slice(WARP.CLOSE + WARP.HOLD, WARP.CLOSE + WARP.HOLD + hall.ENTRIES.front.walkIn);
  assert.ok(walkIn.every((s) => s.mag === 1 && Math.abs(wrapAngle(s.yaw - hall.ENTRIES.front.yaw)) < 1e-9));
  // The wipe: rising to covered, held, falling to nothing.
  const top = g.wipes.indexOf(1);
  for (let i = 1; i <= top; i++) assert.ok(g.wipes[i] > g.wipes[i - 1], `closing at ${i}`);
  assert.equal(g.wipes.filter((a) => a === 1).length, WARP.HOLD + 1);
  assert.equal(g.wipes.at(-1), 0);
  assert.equal(g.areas.wipe(0.5).kind, 'iris');

  const a = g.areas.current;
  assert.equal(g.areas.name, 'hall');
  assert.equal(g.arrivals[0].entry, 'front');
  // Standing at the front entry, the camera behind him (south, toward the door), clear, in the room.
  const { pos, cam } = g.arrivals[0];
  assert.deepEqual([pos.x, pos.y, pos.z], [hall.ENTRIES.front.x, 0, hall.ENTRIES.front.z + HALL_Z]);
  assert.equal(g.arrivals[0].grounded, true);
  assert.equal(g.arrivals[0].action, 'idle');
  assert.ok(cam.z > pos.z + 1000, `camera behind him: z ${cam.z - HALL_Z}`);
  assert.equal(g.arrivals[0].occluded, false);
  assert.ok(Math.abs(cam.x) < hall.HALL.halfX && cam.y > 0 && cam.y < hall.HALL.ceilingY && cam.z - HALL_Z < hall.HALL.southZ, 'inside the room');
  // Walked on in along his facing, north.
  assert.ok(g.player.pos.z < pos.z - 100 && g.player.faceYaw === Math.PI);
  // Nothing on Jonas or the camera still holds the grounds' world.
  assert.deepEqual(worldsIn(g.player, g.cam), [a.collision]);
  assert.notEqual(a.collision, g.level.collision);
  // The renderer, the HUD, the input, the scene.
  assert.equal(g.view.looks.at(-1), HALL_ATMOSPHERE);
  assert.equal(g.view.water, a.waterFn);
  assert.equal(g.view.water(0, HALL_Z), NO_WATER);
  assert.ok(g.view.warm.includes(a.root) && g.view.warm.includes(a.objects.group), 'shaders compiled ahead');
  assert.equal(g.hud.course, 'hall');
  assert.ok(g.input.flushes >= 1);
  assert.equal(a.root.visible, true);
  assert.equal(a.objects.group.visible, true);
  assert.equal(g.objects.group.visible, false, 'the grounds\' objects hidden');
  assert.ok(g.level.parts.every((p) => !p.object3D || p.object3D.visible === false), 'the grounds (and the sky) hidden');
  assert.ok(Number.isFinite(g.areas.buildMs.hall) && g.areas.buildMs.hall < 1000, `built in ${g.areas.buildMs.hall} ms`);
  assert.equal(g.areas.get('hall'), a, 'built once, kept');
});

test('the inner door back out onto the porch, facing out with the camera in front; the castle door takes him in again', () => {
  const g = game();
  assert.equal(g.areas.enter('hall', 'front'), true);
  const hallWorld = g.areas.current.collision;
  const n = g.until(() => g.log.includes('warp:grounds'), 200, g.toward(0));
  assert.ok(n < 200, 'walked south into the inner door');
  assert.ok(g.log.includes('door_open'));
  g.log.length = 0;
  g.phases.length = 0;
  g.sticks.length = 0;
  g.until(() => g.areas.phase === null, 40);
  pushedToward(g, g.areas.get('hall').objects.doors[0].yaw + Math.PI);
  assert.equal(g.areas.name, 'grounds');
  const arrive = g.arrivals.at(-1);
  assert.equal(arrive.entry, 'porch');
  assert.ok(Math.abs(arrive.pos.x - PORCH.x) < 1e-6 && Math.abs(arrive.pos.y - PORCH.y) < 1 && Math.abs(arrive.pos.z - PORCH.z) < 1, JSON.stringify(arrive.pos));
  assert.equal(arrive.faceYaw, 0, 'his back to the door');
  assert.ok(arrive.grounded);
  assert.ok(arrive.cam.z > arrive.pos.z + 1000 && Math.abs(arrive.cam.x) < 50, `camera in front of him: ${arrive.cam.toArray().map(Math.round)}`);
  assert.equal(arrive.occluded, false);
  // He walked out along +Z, the door shut behind him, and it is armed again by the time the
  // wipe has opened.
  assert.ok(g.player.pos.z > PORCH.z + 60 && Math.abs(g.player.pos.x) < 1);
  assert.equal(count(g.log, 'door_close'), 1);
  assert.equal(g.objects.door.armed, true);
  assert.deepEqual(worldsIn(g.player, g.cam), [g.level.collision]);
  assert.ok(!worldsIn(g.player, g.cam).includes(hallWorld));
  assert.equal(g.view.looks.at(-1), null, 'the grounds\' own look');
  assert.equal(g.hud.course, 'grounds');
  assert.equal(g.objects.group.visible, true);
  assert.equal(g.areas.get('hall').root.visible, false);
  assert.ok(g.level.parts.every((p) => !p.object3D || p.object3D.visible), 'the grounds and the sky shown');
  // Back up to the door: in again.
  g.until(() => g.log.includes('warp:hall'), 90, g.toward(Math.PI));
  assert.equal(count(g.log, 'warp:hall'), 1);
  g.until(() => g.areas.phase === null, 40);
  assert.equal(g.areas.name, 'hall');
});

test('walking back toward the camera to the inner door: as he nears it the camera cuts round to the room side, and the stick he holds walks him on into the door', () => {
  const g = game();
  g.areas.enter('hall', 'front');
  g.until(() => false, 20);
  g.until(() => false, 60, { stickY: 1 }); // into the room, the camera behind him (south)
  const door = g.areas.objects.doors[0];
  const front = () => (g.player.pos.x - door.x) * door.sin + (g.player.pos.z - door.z) * door.cos;
  g.resets.length = 0;
  // Back toward the camera (and the door behind it), the stick held down all the way: the
  // camera backs up to the south wall, then, once he is within APPROACH of the door, cuts round
  // behind him; he walks on south (the stick carried across the cut) into the door. It never
  // comes close over him.
  let near = Infinity;
  let cutAt = null;
  let lastZ = g.player.pos.z;
  const back = () => {
    near = Math.min(near, Math.hypot(g.cam.pos.x - g.player.pos.x, g.cam.pos.z - g.player.pos.z));
    assert.equal(g.cam.hideHero, false);
    if (cutAt === null && g.resets.length) cutAt = front();
    return { stickY: -1 };
  };
  const n = g.until(() => g.log.includes('warp:grounds'), 150, () => {
    if (g.resets.length && g.phases.at(-1) === null) {
      assert.ok(g.player.pos.z > lastZ - 1, `still walking south after the cut (${Math.round(g.player.pos.z - lastZ)})`);
    }
    lastZ = g.player.pos.z;
    return back();
  });
  assert.ok(g.log.includes('warp:grounds') && n < 150);
  assert.deepEqual(g.resets, [null], 'one cut, before the door');
  assert.ok(cutAt > WARP.APPROACH - 60 && cutAt <= WARP.APPROACH, `cut ${Math.round(cutAt)} from the door`);
  assert.ok(near > 600, `the camera never came close over him (${Math.round(near)})`);
  // From the cut and while the wipe closes: behind him in the room, clear, well back, looking
  // at the door.
  for (let i = 0; g.areas.phase === 'close'; i++) {
    const c = g.cam.pos;
    const p = g.player.pos;
    assert.ok(c.z < p.z - 800, `tick ${i}: room side (camera z ${Math.round(c.z - HALL_Z)}, Jonas ${Math.round(p.z - HALL_Z)})`);
    assert.ok(Math.hypot(c.x - p.x, c.z - p.z) > 800);
    assert.equal(g.cam.collider.occluded, false);
    assert.equal(g.cam.hideHero, false);
    assert.ok(Math.abs(wrapAngle(g.cam.getYaw() - (door.yaw + Math.PI))) < 0.3, 'looking at the door');
    g.tick({ stickY: -1 });
  }
  pushedToward(g, door.yaw + Math.PI);
  // The stick he still holds comes out on the porch the way he was walking: away from the
  // castle door, not back into it.
  g.until(() => g.areas.phase === null, 40, { stickY: -1 });
  assert.equal(g.areas.name, 'grounds');
  const z = g.player.pos.z;
  g.until(() => false, 20, { stickY: -1 });
  assert.ok(g.player.pos.z > z + 100, `walked on out (z ${Math.round(z)} -> ${Math.round(g.player.pos.z)})`);
});

test('the approach cut is only for a door behind the camera that leads somewhere: walking into the inner door with the camera behind him, or at a door still being built, no cut', () => {
  const g = game();
  g.areas.enter('hall', 'front');
  g.until(() => false, 20);
  // South to the inner door with the camera north of him (behind him): no cut until the door.
  g.player.teleport(0, 0, HALL_Z + 1800, 0);
  g.player.setAction('idle');
  g.cam.reset(g.player);
  g.resets.length = 0;
  g.until(() => g.log.includes('warp:grounds'), 120, { stickY: 1 });
  assert.ok(g.log.includes('warp:grounds'));
  assert.deepEqual(g.resets, [], 'no cut: the camera already looks at the door');
  // East to a door still being built, the camera between him and it: no cut.
  const g2 = game();
  g2.areas.enter('hall', 'front');
  const d = hall.DOORS.find((e) => e.id === 'hall_east_1');
  g2.player.teleport(d.x - 900, 0, HALL_Z + d.z, Math.PI / 2);
  g2.player.setAction('idle');
  g2.cam.reset(g2.player, { yaw: Math.PI / 2 }); // the camera east of him, by the door
  g2.resets.length = 0;
  g2.until(() => g2.dialog.isOpen, 90, g2.toward(Math.PI / 2));
  assert.ok(g2.log.includes('sign:hall_door_soon'));
  assert.deepEqual(g2.resets, []);
});

test('AI RACE seals the castle door, also while it fades out: the laugh and the sealed sign, no warp', () => {
  const g = game();
  const door = g.objects.door;
  const tryDoor = () => {
    g.dialog.isOpen = false;
    g.place(0, 300, door.faceZ + DOOR.REARM + 200, Math.PI); // away: re-armed
    g.tick();
    g.place(0, 300, door.faceZ + 120, Math.PI);
    g.log.length = 0;
    g.tick();
    return [...g.log];
  };
  g.events.emit('darkMode', { on: true });
  g.objects.setDarkness(1);
  let log = tryDoor();
  assert.ok(log.includes('evil_laugh') && log.includes('sign:castle_sealed'), log.join());
  assert.ok(!log.some((n) => n.startsWith('warp:')));
  g.until(() => false, 40);
  assert.equal(g.areas.name, 'grounds');
  assert.equal(g.areas.phase, null);
  // Switched off, but still fading out: sealed.
  g.events.emit('darkMode', { on: false });
  g.objects.setDarkness(0.5);
  log = tryDoor();
  assert.ok(log.includes('sign:castle_sealed') && !log.includes('warp:hall'), log.join());
  // Faded out: open.
  g.objects.setDarkness(0);
  log = tryDoor();
  assert.ok(log.includes('warp:hall') && log.includes('door_open') && !log.includes('evil_laugh'), log.join());
});

test("the hall's doors still being built say so: their sign, no laugh, no warp", () => {
  const g = game();
  g.areas.enter('hall');
  const doors = g.areas.objects.doors;
  for (const [id, sign] of [['hall_east_1', 'hall_door_soon'], ['hall_east_2', 'hall_door_soon']]) {
    const d = doors.find((door) => door.id === id);
    const yaw = d.yaw + Math.PI;
    g.dialog.isOpen = false;
    g.place(d.x + d.sin * 400, d.floorY, d.z + d.cos * 400, yaw);
    g.log.length = 0;
    g.until(() => g.dialog.isOpen, 60, g.toward(yaw));
    assert.ok(g.log.includes(`sign:${sign}`), `${id}: ${g.log.join()}`);
    assert.ok(!g.log.includes('evil_laugh'), `${id}: no laugh`);
    assert.ok(!g.log.some((n) => n.startsWith('warp:')), `${id}: no warp`);
    assert.equal(g.areas.phase, null);
    assert.equal(g.areas.name, 'hall');
  }
});

test('a refused warp: the door stays quiet until he steps off its apron; dying while it closes cancels the switch', () => {
  const g = game();
  const door = g.objects.door;
  g.state.ok = false; // (main: e.g. the meltdown running)
  g.place(0, 300, door.faceZ + 120, Math.PI);
  g.tick();
  assert.equal(count(g.log, 'warp:hall'), 1);
  assert.equal(g.areas.phase, null, 'refused');
  assert.equal(door.armed, false);
  g.state.ok = true;
  g.until(() => false, 20, { stickY: 1 });
  assert.equal(g.areas.phase, null, 'nothing while he stays on the apron');
  assert.equal(door.armed, false);
  g.place(0, 300, door.faceZ + DOOR.REACH + DOOR.APRON + 30, Math.PI);
  g.tick();
  assert.equal(door.armed, true, 'off the apron');
  g.until(() => g.areas.phase !== null, 30, { stickY: 1 });
  assert.equal(g.areas.phase, 'close', 'and in');
  // Dies a few ticks into the close: the wipe opens again from about where it got to.
  g.until(() => false, 5);
  const covered = g.areas.wipe(1).amount;
  g.player.loseHealth(8);
  g.tick();
  assert.equal(g.areas.phase, 'open');
  assert.ok(Math.abs(g.areas.wipe(1).amount - covered) < 0.15, `${g.areas.wipe(1).amount} after ${covered}`);
  g.until(() => g.areas.phase === null, 40);
  assert.equal(g.areas.name, 'grounds');
  assert.ok(!g.log.includes('area:hall'), 'no switch');
  // A request while dying, or for an unknown area or entry, is refused.
  assert.equal(g.areas.request({ to: 'hall', entry: 'front' }), false, 'dying');
  g.place(0, 300, 2000, Math.PI);
  assert.equal(g.areas.request({ to: 'nowhere', entry: 'front' }), false);
  assert.equal(g.areas.request({ to: 'hall', entry: 'nowhere' }), false);
  assert.equal(g.areas.request({ to: 'hall', entry: 'front' }), true);
  assert.equal(g.areas.request({ to: 'hall', entry: 'front' }), false, 'one at a time');
});

test('a warp no longer allowed once the screen is covered (AI RACE came on during close) opens again without a switch', () => {
  const g = game();
  g.place(0, 300, -300, Math.PI);
  g.until(() => g.areas.phase === 'close', 90, { stickY: 1 });
  g.until(() => false, 3);
  g.state.ok = false; // (main: the storm switched on)
  g.until(() => g.areas.phase !== 'close', 20);
  assert.equal(g.areas.phase, 'hold');
  g.tick(); // the first covered tick: asked again
  assert.equal(g.areas.phase, 'open');
  assert.equal(g.areas.wipe(0).amount, 1, 'opening from covered');
  g.until(() => g.areas.phase === null, 40);
  assert.equal(g.areas.name, 'grounds');
  assert.ok(!g.log.includes('area:hall'), 'no switch');
  assert.equal(g.input.flushes, 0);
  assert.deepEqual(worldsIn(g.player, g.cam), [g.level.collision]);
});

test('a stick held through the inner door walks him on out across the camera cut, not back in; let go (or turned) it is the new camera\'s', () => {
  const g = game();
  g.areas.enter('hall', 'front');
  // South toward the inner door with the camera behind him (north): forward is south.
  g.place(0, 0, HALL_Z + 2000, 0);
  g.log.length = 0;
  const forward = { stickY: 1 };
  g.until(() => g.log.includes('area:grounds'), 120, forward);
  assert.equal(g.areas.name, 'grounds');
  // On the porch the camera is in front of him, looking at the door: read by it, the same push
  // is into the door.
  assert.ok(Math.abs(wrapAngle(stickToWorldYaw(0, 1, g.cam.getYaw()) - Math.PI)) < 0.1);
  // Held on, it walks him out and away (the door re-armed behind him) for as long as it is held.
  g.until(() => false, 90, forward);
  assert.equal(g.areas.name, 'grounds');
  assert.equal(count(g.log, 'area:grounds'), 1);
  assert.ok(!g.log.includes('warp:hall'), g.log.join());
  assert.equal(g.objects.door.armed, true);
  assert.ok(g.player.pos.z > PORCH.z + 1500, `walked out to z ${Math.round(g.player.pos.z)}`);
  assert.ok(Math.abs(wrapAngle(g.player.faceYaw)) < 0.1, 'facing out');
  assert.equal(g.areas.carry, true);
  // His buttons stay his: A jumps.
  g.tick({ stickY: 1, A: true });
  assert.equal(g.player.action, 'jump');
  g.until(() => g.player.grounded, 60, forward);
  // A small wobble keeps it; a clear turn hands the stick to the camera.
  g.tick({ stickX: Math.sin(0.4), stickY: Math.cos(0.4) });
  assert.equal(g.areas.carry, true);
  g.tick({ stickX: 1 });
  assert.equal(g.areas.carry, false);
  // Forward now means what the camera shows: back toward the castle.
  const n = g.until(() => Math.abs(wrapAngle(g.player.faceYaw - Math.PI)) < 0.2, 40, forward);
  assert.ok(n < 40, `turned toward the castle: faceYaw ${g.player.faceYaw}`);
  // The same after letting go: through the door again with it held, then released.
  g.place(0, 0, 0, 0);
  g.areas.enter('hall', 'front');
  g.place(0, 0, HALL_Z + 2000, 0);
  g.until(() => g.areas.name === 'grounds' && g.areas.phase === null, 120, forward);
  assert.equal(g.areas.carry, true);
  g.tick();
  assert.equal(g.areas.carry, false, 'let go');
  g.until(() => g.log.includes('warp:hall'), 150, forward);
  assert.ok(g.log.includes('warp:hall'), 'pushed forward again (as the camera shows it), into the castle');
});

test("enter('grounds', 'start') brings back the grounds' spawn, signs and collision", () => {
  const g = game();
  g.areas.enter('hall');
  assert.equal(g.player.collision, g.areas.current.collision);
  const front = hall.ENTRIES.front;
  assert.deepEqual(g.player.spawn, { x: front.x, y: front.y, z: front.z + HALL_Z, yaw: front.yaw, drop: hall.RESPAWN.drop });
  assert.deepEqual(g.player.signs.map((e) => e.sign.id), hall.SIGNS.map((e) => e.id), "the hall's signs");
  assert.deepEqual(g.player.signs.map((e) => e.z - HALL_Z), hall.SIGNS.map((e) => e.z), 'in world coordinates');
  g.dialog.isOpen = true;
  g.areas.enter('grounds', 'start');
  assert.equal(g.dialog.isOpen, false, 'a dialog up is closed');
  const s = g.level.spawn;
  assert.deepEqual(g.player.spawn, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, drop: undefined });
  assert.deepEqual([g.player.pos.x, g.player.pos.y, g.player.pos.z], [s.x, s.y, s.z]);
  assert.deepEqual(g.player.signs.map((e) => e.sign.id), g.level.layout.SIGNS.map((e) => e.id));
  assert.equal(g.player.collision, g.level.collision);
  assert.equal(g.cam.collision, g.level.collision);
  assert.deepEqual(worldsIn(g.player, g.cam), [g.level.collision]);
  assert.equal(g.view.looks.at(-1), null);
  assert.equal(g.areas.name, 'grounds');
});

// A small course of our own, far out east: a floor, a placed star north of the arrival, a star
// exit and a way out from the pause screen, both to the porch.
const floorPart = () => {
  const solids = new SolidBuilder();
  solids.box(-2000, 2000, -200, 0, -2000, 2000, 'stone');
  return { object3D: new THREE.Group(), colliders: solids.colliders() };
};
const COURSE = {
  name: 'course',
  origin: { x: 60000, y: 0, z: 0 },
  builders: [floorPart],
  layout: { STAR: { id: 'course_star', x: 0, y: 160, z: -300, placed: true }, DOORS: [] },
  entries: { arrival: { x: 0, y: 0, z: 400, yaw: Math.PI } },
  respawn: { entry: 'arrival', drop: 1600 },
  waterLevelAt: () => NO_WATER,
  probeY: 1000,
  sky: true,
  atmosphere: null,
  audio: { music: null, ambience: 'grounds', reverb: false },
  leave: { to: 'grounds', entry: 'porch' },
  starExit: { to: 'grounds', entry: 'porch' },
};

test('buildArea: a hidden root at the origin; colliders, poles, water, entries and the layout shifted into world coordinates', () => {
  const scene = new THREE.Scene();
  const part = () => {
    const solids = new SolidBuilder();
    solids.box(-1000, 1000, -200, 0, -1000, 1000, 'stone');
    solids.box(200, 400, 0, 300, 200, 400, 'wood');
    return { object3D: new THREE.Group(), colliders: solids.colliders(), poles: [{ x: -500, z: 0, y0: 0, y1: 900, radius: 30 }] };
  };
  const def = {
    ...COURSE,
    builders: [part],
    waterLevelAt: (x, z) => (x < -500 ? -50 : NO_WATER),
    layout: {
      COINS: [{ x: 10, y: 60, z: 20 }],
      SIGNS: [{ id: 'hello', x: 0, y: 0, z: 500, yaw: 0, pages: ['Hello'] }],
      STAR: { id: 's', x: 1, y: 160, z: 2, placed: true },
      DOORS: [{ id: 'd', x: 0, z: -900, yaw: 0, floorY: 0, to: 'grounds', entry: 'porch' }],
      POLES: [{ x: 500, z: -500, y0: 0, y1: 1200, radius: 40 }],
    },
    origin: { x: 60000, y: 100, z: -2000 },
  };
  const a = buildArea(scene, def);
  const o = def.origin;
  assert.equal(a.root.parent, scene);
  assert.equal(a.root.name, 'area-course');
  assert.deepEqual(a.root.position.toArray(), [o.x, o.y, o.z]);
  assert.equal(a.root.visible, false);
  assert.equal(a.collision.findFloor(o.x, o.y + 500, o.z).y, o.y, 'the floor, moved');
  assert.equal(a.collision.findFloor(o.x + 300, o.y + 500, o.z + 300).y, o.y + 300, 'the block on it');
  assert.equal(a.collision.findFloor(0, 500, 0).surface, null, 'nothing left at the local spot');
  assert.equal(a.collision.findFloor(o.x + 300, o.y + 500, o.z + 300).surface.terrain, 'wood');
  assert.ok(a.collision.findPole(o.x - 500, o.y + 100, o.z, 80), 'the part\'s pole');
  assert.ok(a.collision.findPole(o.x + 500, o.y + 100, o.z - 500, 80), 'the layout\'s pole');
  assert.equal(a.waterFn(o.x - 800, o.z), o.y - 50);
  assert.equal(a.waterFn(o.x + 800, o.z), NO_WATER);
  assert.deepEqual(a.entries.arrival, { x: o.x, y: o.y, z: o.z + 400, yaw: Math.PI });
  assert.deepEqual(a.respawn, { x: o.x, y: o.y, z: o.z + 400, yaw: Math.PI, drop: COURSE.respawn.drop });
  assert.deepEqual(a.objectsLayout.COINS, [{ x: o.x + 10, y: o.y + 60, z: o.z + 20 }]);
  assert.deepEqual(a.objectsLayout.STAR, { id: 's', x: o.x + 1, y: o.y + 160, z: o.z + 2, placed: true });
  assert.deepEqual(a.objectsLayout.DOORS[0], { id: 'd', x: o.x, z: o.z - 900, yaw: 0, floorY: o.y, to: 'grounds', entry: 'porch' });
  assert.deepEqual(a.signs, [{ id: 'hello', x: o.x, y: o.y, z: o.z + 500, yaw: 0, pages: ['Hello'] }]);
  assert.equal(a.groundAt(o.x, o.z), o.y);
  assert.equal(def.layout.COINS[0].x, 10, 'the local layout is left as it was');
  assert.deepEqual(shiftPositions([1, 2, 3, 4, 5, 6], { x: 10, y: 20, z: 30 }), [11, 22, 33, 14, 25, 36]);
  // An { object3D } collider is refused (it would stay where the builder left it).
  const bad = () => ({ object3D: new THREE.Group(), colliders: [{ object3D: new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10)) }] });
  assert.throws(() => buildArea(new THREE.Scene(), { ...def, builders: [bad] }), /colliders must be \{ positions \}/);
});

test("a course's own star: the exit waits out the dance, then fades to gold-white; GAME OVER's resetCourses takes it back", () => {
  const g = game({ ...AREA_DEFS, course: COURSE });
  g.areas.enter('course');
  const course = g.areas.current;
  assert.equal(g.level.parts.find((p) => p.name === 'sky').object3D.visible, true, 'the sky shows over the course');
  assert.equal(g.areas.canLeave(), true);
  // Rustmaw's star, or a star from another area, ends nothing.
  assert.equal(g.areas.onStar({ pos: {}, boss: true }), false);
  assert.equal(g.areas.onStar({ pos: {}, id: null, area: 'grounds' }), false);
  const stars = [];
  g.events.on('starCollected', (e) => stars.push(e));
  g.until(() => stars.length > 0, 60, { stickY: 1 });
  assert.deepEqual([stars[0].id, stars[0].area], ['course_star', 'course']);
  assert.equal(g.areas.phase, 'star');
  assert.equal(g.areas.busy, true);
  const { out, fade } = danceThenFade(g);
  assert.ok(out > 60, `his dance: ${out} ticks`);
  assert.equal(WARP.STAR_AFTER, 20);
  assert.equal(fade - out, 20, `the fade 20 ticks after the dance: ${out} -> ${fade}`);
  assert.deepEqual({ ...g.areas.wipe(1), amount: 0 }, { amount: 0, kind: 'fade', color: '#fff4d0' });
  g.phases.length = 0;
  g.until(() => g.areas.phase === null, 60);
  assert.deepEqual(runs(g.phases).slice(0, 2), [['close', WARP.STAR_CLOSE], ['hold', WARP.HOLD]]);
  assert.equal(g.areas.name, 'grounds');
  assert.equal(g.arrivals.at(-1).entry, 'porch');
  assert.equal(g.player.stars, 1);
  // GAME OVER: the star back on its spot, and off his count.
  g.areas.enter('grounds', 'start');
  g.areas.resetCourses();
  assert.equal(g.player.stars, 0);
  assert.equal(course.objects.star.state, 'idle');
  assert.equal(course.objects.star.mesh.visible, true);
});

test('leave(): the way out of a course from the pause screen, an iris to its leave entry; the grounds have none', () => {
  const g = game({ ...AREA_DEFS, course: COURSE });
  assert.equal(g.areas.canLeave(), false, 'the grounds have no way out');
  assert.equal(g.areas.leave(), false);
  g.areas.enter('course');
  assert.equal(g.areas.canLeave(), true);
  g.state.ok = false;
  assert.equal(g.areas.canLeave(), false, 'not while a warp would be refused');
  g.state.ok = true;
  assert.equal(g.areas.leave(), true);
  assert.equal(g.areas.canLeave(), false, 'not twice');
  assert.equal(g.areas.wipe(1).kind, 'iris');
  g.until(() => g.areas.phase === null, 40);
  assert.equal(g.areas.name, 'grounds');
  assert.equal(g.arrivals.at(-1).entry, 'porch');
});

// A course whose arrival stands in a door's trigger, facing it (a landing at a door).
const DOORWAY = {
  ...COURSE,
  name: 'doorway',
  layout: { DOORS: [{ id: 'back', x: 0, z: 300, yaw: 0, width: 420, floorY: 0, to: 'grounds', entry: 'porch' }] },
  entries: { arrival: { x: 0, y: 0, z: 400, yaw: Math.PI } },
};

test('every switch makes the new area\'s objects forget his last tick and keeps a door he arrives at quiet until he walks off it', () => {
  const g = game({ ...AREA_DEFS, doorway: DOORWAY });
  const valid = []; // the new area's objects: is his last tick still theirs, as the switch ends?
  g.events.on('areaChange', () => valid.push(g.areas.objects.hero.valid));
  g.place(0, 300, 2000, Math.PI);
  g.tick();
  assert.equal(g.objects.hero.valid, true);
  g.log.length = 0;
  assert.equal(g.areas.request({ to: 'doorway', entry: 'arrival' }), true);
  g.until(() => g.areas.phase === null, 40);
  assert.equal(g.areas.name, 'doorway');
  const door = g.areas.objects.doors[0];
  assert.equal(door.atDoor(g.player), true, 'standing in it, facing it');
  g.until(() => false, 30);
  assert.equal(door.armed, false, 'kept quiet');
  assert.ok(!g.log.includes('warp:grounds') && !g.log.includes('door_open'), g.log.join());
  // Back to the grounds (their objects saw him last tick there) and straight in again (the
  // doorway's saw him just now): each forgets.
  assert.equal(g.areas.objects.hero.valid, true);
  g.areas.enter('grounds', 'start');
  g.areas.enter('doorway', 'arrival');
  assert.deepEqual(valid, [false, false, false]);
  g.tick();
  assert.equal(door.armed, false);
  assert.ok(!g.log.includes('warp:grounds'));
  // Off its apron and back: the door works.
  g.place(door.x, 0, door.z + DOOR.REACH + DOOR.APRON + 50, Math.PI);
  g.tick();
  assert.equal(door.armed, true);
  g.until(() => g.log.includes('warp:grounds'), 30, g.toward(Math.PI));
  assert.ok(g.log.includes('warp:grounds') && g.log.includes('door_open'));
});

// ---------------------------------------------------------------- Midsummer Skerries

// Jonas standing on the hall's landing in front of the bottle's mouth, facing it.
const onLanding = (g) => g.place(0, hall.LANDING.top, HALL_Z - 1100, Math.PI);

test("into the bottle's neck: its own sound and the iris, then Midsummer Skerries: he drops in onto the jetty with the camera behind him, the course's look and sky, its card on the first entry of a game", () => {
  const g = game();
  g.areas.enter('hall');
  onLanding(g);
  g.log.length = 0;
  g.until(() => g.log.includes('warp:skerries'), 60, { stickY: 1 });
  assert.ok(g.log.includes('bottle_dive') && !g.log.includes('door_open'), g.log.join());
  assert.equal(g.areas.wipe(1).kind, 'iris');
  g.phases.length = 0;
  g.until(() => g.areas.phase === null, 40);
  assert.deepEqual(runs(g.phases), [['close', WARP.CLOSE], ['hold', WARP.HOLD], ['open', WARP.OPEN]]);
  const a = g.areas.current;
  assert.equal(g.areas.name, 'skerries');
  const arrive = g.arrivals.at(-1);
  const e = sk.ENTRIES.arrival;
  assert.equal(arrive.entry, 'arrival');
  assert.equal(arrive.action, 'spawn', 'dropping in from the sky');
  assert.deepEqual([arrive.pos.x, arrive.pos.y, arrive.pos.z], [e.x + SK.x, e.y + e.drop + SK.y, e.z + SK.z]);
  assert.equal(arrive.faceYaw, Math.PI, 'facing north, up the Sound');
  assert.ok(arrive.cam.z > arrive.pos.z + 800, `the camera behind him: ${arrive.cam.toArray().map(Math.round)}`);
  assert.equal(arrive.occluded, false);
  // The course: its look, its water, the sky dome, its own world on Jonas and the camera.
  assert.equal(g.view.looks.at(-1), SKERRIES_ATMOSPHERE);
  assert.equal(g.view.water(SK.x, SK.z), SK.y + sk.SEA_LEVEL);
  assert.equal(g.level.parts.find((p) => p.name === 'sky').object3D.visible, true);
  assert.deepEqual(worldsIn(g.player, g.cam), [a.collision]);
  assert.equal(g.hud.course, 'skerries');
  assert.equal(g.areas.canLeave(), false, 'no way out while he drops in');
  assert.deepEqual(g.hud.cards, ['skerries']);
  assert.deepEqual(g.player.spawn, { x: e.x + SK.x, y: e.y + SK.y, z: e.z + SK.z, yaw: e.yaw, drop: sk.RESPAWN.drop });
  // He lands on the jetty, the camera still behind him (south), looking up the Sound.
  g.until(() => g.player.grounded, 80);
  assert.ok(Math.abs(g.player.pos.y - SK.y - sk.JETTY.top) < 1 && Math.abs(g.player.pos.z - SK.z - e.z) < 1);
  assert.ok(g.cam.pos.z > g.player.pos.z + 800 && !g.cam.collider.occluded);
  assert.equal(g.areas.canLeave(), true, 'standing there, the pause screen offers the way out');
  // The card once a game: not on a second entry, again after GAME OVER's resetCourses().
  g.areas.enter('hall');
  g.areas.enter('skerries');
  assert.deepEqual(g.hud.cards, ['skerries']);
  g.areas.resetCourses();
  g.areas.enter('grounds', 'start');
  assert.equal(g.areas.canLeave(), false, 'no way out of the grounds');
  g.areas.enter('skerries');
  assert.deepEqual(g.hud.cards, ['skerries', 'skerries']);
});

test("the course's star on the lighthouse gallery: the exit waits out his dance and 20 ticks more, then fades to gold-white and he pops out of the bottle onto the hall's landing, one star up; a stick held on waits to be let go; the star stays taken", () => {
  const g = game();
  g.areas.enter('skerries');
  const L = sk.LIGHTHOUSE;
  const S = sk.STAR;
  // On the gallery just south of the star, walking north into it.
  g.player.teleport(S.x + SK.x, L.gallery + SK.y, S.z + 250 + SK.z, Math.PI);
  g.player.setAction('idle');
  g.cam.reset(g.player);
  const stars = [];
  g.events.on('starCollected', (e) => stars.push(e));
  g.until(() => stars.length > 0, 60, g.toward(Math.PI));
  assert.deepEqual([stars[0].id, stars[0].area], ['skerries_star', 'skerries']);
  assert.equal(g.player.stars, 1);
  assert.equal(g.areas.phase, 'star');
  const { out, fade } = danceThenFade(g);
  assert.ok(out > 60, `his dance: ${out} ticks`);
  assert.equal(fade - out, 20, `the fade 20 ticks after the dance: ${out} -> ${fade}`);
  assert.equal(g.areas.wipe(1).kind, 'fade');
  // Out of the bottle, the stick still pushed forward as it was on the gallery (with the camera
  // south of him, toward the bottle's mouth): he pops out with its sound as the fade opens.
  const pops = [];
  g.events.on('sfx', (e) => e.name === 'bottle_pop' && pops.push({ phase: g.areas.phase, t: g.areas.t, pos: e.pos }));
  g.log.length = 0;
  g.until(() => g.areas.phase === null, 60, { stickY: 1 });
  assert.equal(g.areas.name, 'hall');
  const arrive = g.arrivals.at(-1);
  const b = hall.ENTRIES.bottle;
  assert.equal(arrive.entry, 'bottle');
  assert.deepEqual([arrive.pos.x, arrive.pos.y, arrive.pos.z], [b.x, b.y + b.drop, b.z + HALL_Z]);
  assert.ok(arrive.cam.z > arrive.pos.z + 800, 'the camera south of him, the bottle behind him');
  assert.equal(g.player.stars, 1);
  assert.equal(g.areas.canLeave(), false, 'the hall is no course');
  assert.deepEqual(pops, [{ phase: 'open', t: 0, pos: { x: b.x, y: b.y, z: b.z + HALL_Z } }], 'once, as the fade opens');
  assert.ok(g.log.indexOf('area:hall') < g.log.indexOf('bottle_pop'));
  // The mouth is armed (he stands off its apron), but the stick held on from the course waits
  // to be let go: he stays put instead of walking straight back in.
  const mouth = g.areas.objects.doors.find((d) => d.id === 'bottle');
  assert.equal(mouth.near(g.player), false, 'off the apron');
  g.until(() => false, 60, { stickY: 1 });
  assert.equal(mouth.armed, true);
  assert.ok(!g.log.includes('warp:skerries'), g.log.join());
  assert.ok(g.player.grounded && Math.abs(g.player.pos.z - HALL_Z - b.z) < 1, `still where he popped out: ${g.player.pos.z - HALL_Z}`);
  assert.equal(g.areas.still, true);
  // Let go, then a fresh push toward the bottle walks him straight back in (no stepping back).
  g.tick();
  assert.equal(g.areas.still, false);
  const z0 = g.player.pos.z;
  g.until(() => g.log.includes('warp:skerries'), 30, g.toward(Math.PI));
  assert.ok(g.log.includes('warp:skerries') && g.log.includes('bottle_dive'), g.log.join());
  assert.ok(z0 - g.player.pos.z < 200, `in at once: ${Math.round(z0 - g.player.pos.z)} walked`);
  g.until(() => g.areas.phase === null, 40);
  assert.equal(g.areas.name, 'skerries');
  // Back in the course the gallery is empty: standing where the star was takes nothing.
  g.until(() => g.player.grounded, 80);
  g.player.teleport(S.x + SK.x, L.gallery + SK.y, S.z + SK.z, Math.PI);
  g.player.setAction('idle');
  g.until(() => false, 10);
  assert.equal(stars.length, 1, 'no second starCollected');
  assert.equal(g.player.stars, 1);
  assert.notEqual(g.areas.objects.star.state, 'idle');
  assert.equal(g.areas.phase, null);
});

test("leave(), the pause screen's way out: back out of the bottle onto the hall's landing (an iris, the pop); open while he reads a sign (it closes), not while he drops in or dies", () => {
  const g = game();
  g.areas.enter('skerries');
  assert.equal(g.player.action, 'spawn');
  assert.equal(g.areas.canLeave(), false, 'not while he drops in (the close would call it off)');
  assert.equal(g.areas.leave(), false);
  assert.equal(g.areas.phase, null);
  g.until(() => g.player.grounded, 80);
  assert.equal(g.areas.canLeave(), true);
  // Reading the welcome sign (its last page: "Press pause if you want to leave the course."):
  // the way out is open, and taking it closes the sign first.
  const sign = sk.SIGNS.find((e) => e.id === 'skerries_welcome');
  g.place(sign.x + SK.x, sign.y + SK.y, sign.z + 130 + SK.z, Math.PI);
  g.tick({ B: true });
  assert.ok(g.log.includes('sign:skerries_welcome'), g.log.join());
  assert.equal(g.player.action, 'reading');
  assert.equal(g.dialog.isOpen, true);
  assert.equal(g.areas.canLeave(), true, 'reading is no bar');
  const pops = [];
  g.events.on('sfx', (e) => e.name === 'bottle_pop' && pops.push(g.areas.phase));
  assert.equal(g.areas.leave(), true);
  assert.equal(g.dialog.isOpen, false, 'the sign closed');
  assert.notEqual(g.player.action, 'reading');
  assert.equal(g.areas.warp.kind, 'leave');
  assert.equal(g.areas.canLeave(), false, 'not twice');
  assert.deepEqual({ ...g.areas.wipe(1), amount: 0 }, { amount: 0, kind: 'iris', color: '#000000' });
  g.until(() => g.areas.phase === null, 40);
  assert.equal(g.areas.name, 'hall');
  assert.equal(g.arrivals.at(-1).entry, 'bottle');
  assert.deepEqual(pops, ['open'], 'popping out of the bottle');
  assert.equal(g.areas.canLeave(), false, 'the hall is no course');
  // Dying in the course: no way out offered.
  g.areas.enter('skerries');
  g.until(() => g.player.grounded, 80);
  g.player.loseHealth(8);
  g.until(() => g.player.action === 'death', 30);
  assert.equal(g.player.action, 'death');
  assert.equal(g.areas.canLeave(), false, 'not while he dies');
  assert.equal(g.areas.leave(), false);
});

test("main's pause: the way out is offered as the game pauses only while it can be taken; paused, B takes it (unpause, then leave)", () => {
  const MAIN = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const tick = MAIN.slice(MAIN.indexOf('function tick('), MAIN.indexOf('state.time += FRAME_DT', MAIN.indexOf('function tick(')));
  // Each piece after the one before it.
  let at = 0;
  for (const x of [
    'controller.START.pressed && !areas.busy',
    'const leave = state.paused && areas.canLeave()',
    'hud.setLeave?.(leave)',
    "events.emit(state.paused ? 'pause' : 'unpause', { leave })",
    'if (state.paused) {',
    'controller.B.pressed && areas.canLeave()',
    'state.paused = false',
    'hud.setPaused?.(false)',
    "events.emit('unpause')",
    'areas.leave()',
    'return;',
  ]) {
    const i = tick.indexOf(x, at);
    assert.ok(i >= 0, `"${x}" after the step before it`);
    at = i + x.length;
  }
});

test('a life lost in the course drops him back in at the arrival, from the sky onto the jetty', () => {
  const g = game();
  g.areas.enter('skerries');
  g.until(() => g.player.grounded, 80);
  // Out in the Sound, then he runs out of health.
  g.player.teleport(SK.x, SK.y - 200, SK.z - 500, Math.PI);
  g.player.loseHealth(8);
  g.until(() => g.player.action === 'spawn', 200);
  assert.equal(g.player.action, 'spawn');
  const e = sk.ENTRIES.arrival;
  assert.ok(Math.abs(g.player.pos.x - SK.x - e.x) < 1 && Math.abs(g.player.pos.z - SK.z - e.z) < 1 && g.player.pos.y - SK.y > e.y + 1000, JSON.stringify(g.player.pos));
  g.until(() => g.player.grounded, 120);
  assert.ok(Math.abs(g.player.pos.y - SK.y - sk.JETTY.top) < 1, 'on the jetty');
  assert.equal(g.areas.name, 'skerries');
});

test("GAME OVER from the course: main brings the grounds back before the resets and the title; the course's star, coins and lamp are all back", () => {
  // main.js's order (gameOver's setTimeout body).
  const MAIN = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const body = MAIN.slice(MAIN.indexOf('function gameOver('), MAIN.indexOf('\n  }\n', MAIN.indexOf('function gameOver(')));
  const order = ["areas.enter('grounds', 'start')", 'areas.resetCourses()', 'objects.reset()', 'meltdown.reset()', 'player.coins = 0', 'await runTitle()'].map((x) => body.indexOf(x));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in this order');
  // The flow: a coin and the star taken, the lamp lit, then GAME OVER's two calls.
  const g = game();
  g.areas.enter('skerries');
  const course = g.areas.current;
  const lighthouse = course.parts.find((p) => p.name === 'skerries');
  const c = sk.COINS[0];
  g.player.teleport(c.x + SK.x, sk.JETTY.top + SK.y, c.z + SK.z, Math.PI);
  g.player.setAction('idle');
  g.tick();
  assert.equal(course.objects.coins.coins[0].alive, false, 'a coin taken');
  g.player.teleport(sk.STAR.x + SK.x, sk.LIGHTHOUSE.gallery + SK.y, sk.STAR.z + SK.z, 0);
  g.player.setAction('idle');
  g.tick();
  assert.equal(g.player.stars, 1);
  lighthouse.setLit(true);
  g.areas.enter('grounds', 'start');
  g.areas.resetCourses();
  assert.equal(g.areas.name, 'grounds');
  assert.deepEqual(worldsIn(g.player, g.cam), [g.level.collision]);
  assert.equal(g.player.stars, 0, 'the star taken back off his count');
  assert.equal(course.objects.star.state, 'idle', 'and back on its spot');
  assert.equal(course.objects.coins.coins[0].alive, true, 'the coin back');
  assert.equal(lighthouse.lit, false, 'the lamp out');
});
