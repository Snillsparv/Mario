// The locked castle door in node: walking up to it (in front, close, on the porch, facing it)
// plays the evil laugh and opens the dialog with the castle_locked sign; nothing from the
// side, from behind, from too far, below the porch or facing away; once only until Pip has
// walked more than 500 away; the same in AI RACE mode; reset() re-arms it; the door face and
// porch height come from the collision world when it has them; a hero placed at the door
// (objects.enter, an arrival) does not set it off until he has walked away and come back.
// Doors that lead somewhere (Door.js, layout.DOORS, the castle's with CASTLE.enter): turned by
// their yaw (facing -Z, facing -X), an open one creaks and asks for the warp once, then waits
// until he is off its apron; sealed (AI RACE on or fading out: ObjectManager) it shows its
// sealed sign with the laugh and waits for REARM instead; a locked one shows its locked sign,
// sealed or not, laughing if it should and otherwise rattling in its frame; disarm() and
// near(); nothing allocated per tick, nor by the warp's timeline (core/AreaSwitch.js) and the
// door leaves it swings every frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { Events } from '../src/core/events.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { CastleDoor, DOOR, CASTLE_LOCKED, CASTLE_SEALED } from '../src/objects/CastleDoor.js';
import { Door } from '../src/objects/Door.js';
import { AreaSwitch } from '../src/core/AreaSwitch.js';
import { doorLeaves } from '../src/world/castle/building.js';
import { buildArea } from '../src/world/area.js';
import { NO_WATER } from '../src/core/constants.js';

const CASTLE = { x: 0, frontZ: -700, baseY: 160, doorWidth: 420, doorHeight: 620 };
const PORCH = 300;
const FACE = -644;
const S = 6000;

// Courtyard at baseY, a porch box (top PORCH) from the facade out to z = -410, and the door
// face: a wall facing +Z at z = FACE.
function castleWorld() {
  const w = new CollisionWorld();
  const B = CASTLE.baseY;
  w.addTriangles([-S, B, S, S, B, S, S, B, -S, -S, B, S, S, B, -S, -S, B, -S]);
  w.addTriangles([-800, PORCH, -700, -800, PORCH, -410, 800, PORCH, -410, -800, PORCH, -700, 800, PORCH, -410, 800, PORCH, -700]);
  w.addTriangles([-800, B, -410, 800, B, -410, 800, PORCH, -410, -800, B, -410, 800, PORCH, -410, -800, PORCH, -410]);
  w.addTriangles([-300, PORCH, FACE, 300, PORCH, FACE, 300, 1000, FACE, -300, PORCH, FACE, 300, 1000, FACE, -300, 1000, FACE]);
  w.finalize();
  return w;
}

function fakePlayer(x, y, z, yaw = Math.PI) {
  return { pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, action: 'idle', faceYaw: yaw, collectCoin() {}, collectStar() {} };
}

function setup(extra = {}) {
  const events = new Events();
  const log = [];
  events.on('sfx', (e) => e.name === 'evil_laugh' && log.push({ laugh: true }));
  events.on('signRead', (e) => log.push({ sign: e.sign }));
  const player = fakePlayer(0, CASTLE.baseY, 2000);
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision: castleWorld(), events, layout: { CASTLE, groundHeight: () => CASTLE.baseY, ...extra }, player, fx: null });
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) objects.update({ player });
  };
  return { objects, door: objects.door, player, events, log, step };
}

test('the door face and porch come from the collision world', () => {
  const { door } = setup();
  assert.ok(Math.abs(door.faceZ - FACE) < 1e-6, `face ${door.faceZ}`);
  assert.equal(door.porchY, PORCH);
  // Without a collision world: frontZ + RECESS and baseY + PORCH.
  const bare = new CastleDoor({ castle: CASTLE, collision: null, events: new Events() });
  assert.equal(bare.faceZ, CASTLE.frontZ + DOOR.RECESS);
  assert.equal(bare.porchY, CASTLE.baseY + DOOR.PORCH);
});

test('walking up to the door laughs and shows the locked message, once', () => {
  const { player, log, step } = setup();
  step();
  // Walk from the courtyard up onto the porch toward the door.
  for (let z = -200; z >= FACE + 55; z -= 15) {
    player.pos = { x: 0, y: z > -410 ? CASTLE.baseY : PORCH, z };
    step();
  }
  assert.equal(log.length, 2);
  assert.ok(log[0].laugh);
  assert.equal(log[1].sign.id, 'castle_locked');
  assert.deepEqual(log[1].sign.pages, ['The castle door is sealed shut...', 'You cannot enter the castle without a key!']);
  assert.deepEqual(log[1].sign.pages, [...CASTLE_LOCKED.pages]);
  // Standing there (and after the dialog closes) nothing more.
  step(90);
  assert.equal(log.length, 2);
});

test('nothing when facing away, from the side, too far, below the porch or while reading', () => {
  const cases = [
    [0, PORCH, FACE + 100, 0], // facing away (yaw 0 = +Z)
    [0, PORCH, FACE + 100, Math.PI / 2], // facing sideways
    [CASTLE.doorWidth / 2 + DOOR.SIDE_MARGIN + 40, PORCH, FACE + 100, Math.PI], // beside the door
    [0, PORCH, FACE + DOOR.REACH + 30, Math.PI], // too far out (edge of the porch)
    [0, CASTLE.baseY - 200, FACE + 100, Math.PI], // far below (in a pit)
  ];
  for (const [x, y, z, yaw] of cases) {
    const { player, log, step } = setup();
    player.pos = { x, y, z };
    player.faceYaw = yaw;
    step(3);
    assert.equal(log.length, 0, `${x}, ${y}, ${z}, ${yaw}`);
  }
  const { player, log, step } = setup();
  player.pos = { x: 0, y: PORCH, z: FACE + 80 };
  player.action = 'reading';
  step();
  assert.equal(log.length, 0, 'reading');
  player.action = 'push'; // pushing against it counts even at an angle
  player.faceYaw = Math.PI / 2 + 0.2;
  step();
  assert.equal(log.length, 2);
});

test('it re-arms only after Pip has walked more than 500 away', () => {
  const { player, log, step, door } = setup();
  player.pos = { x: 0, y: PORCH, z: FACE + 80 };
  step();
  assert.equal(log.length, 2);
  // Back off 400 and return: nothing.
  player.pos = { x: 0, y: CASTLE.baseY, z: FACE + 400 };
  step();
  player.pos = { x: 0, y: PORCH, z: FACE + 80 };
  step();
  assert.equal(log.length, 2);
  assert.equal(door.armed, false);
  // Away past 500, then back: again.
  player.pos = { x: 0, y: CASTLE.baseY, z: FACE + DOOR.REARM + 50 };
  step();
  assert.equal(door.armed, true);
  player.pos = { x: 0, y: PORCH, z: FACE + 80 };
  step();
  assert.equal(log.length, 4);
  assert.equal(door.triggers, 2);
});

test('the same in AI RACE mode; reset() re-arms it', () => {
  const { objects, player, log, step, events } = setup();
  events.emit('darkMode', { on: true });
  objects.setDarkness(1);
  player.pos = { x: 30, y: PORCH, z: FACE + 120 };
  step();
  assert.equal(log.length, 2);
  objects.reset();
  assert.equal(objects.door.armed, true);
  step();
  assert.equal(log.length, 4);
});

test('nothing hurts Pip while the door message is up (he is frozen); fireballs do again once it closes', () => {
  const { objects, player, log, step, events } = setup({ KAIJU: { x: 0, z: -3000, yaw: 0 } });
  const hits = [];
  player.takeDamage = (n, from, opts) => hits.push({ n, opts });
  events.emit('darkMode', { on: true });
  objects.setDarkness(1);
  player.pos = { x: 0, y: PORCH, z: FACE + 100 };
  step();
  assert.equal(log[1].sign.id, 'castle_locked');
  assert.equal(objects.dialogOpen, true);
  const balls = objects.fireballs;
  // A ball already in flight comes straight down on him, another one lands beside him.
  const drop = (dx) => balls.launch(player.pos.x + dx, player.pos.y + 600, player.pos.z, 0, 0, 0);
  drop(0);
  drop(120);
  step(45);
  assert.equal(balls.inFlight, 0, 'both burst');
  assert.ok(balls.impacts >= 2);
  assert.equal(hits.length, 0, 'no direct hit, blast or fire-zone damage while the message is up');
  // The box is closed: the flames he is standing in burn him again.
  events.emit('dialogClosed', { sign: log[1].sign });
  step();
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].opts, { fire: true });
});

test('the dialog opened by the door carries a fresh sign each time', () => {
  const { player, log, step } = setup();
  player.pos = { x: 0, y: PORCH, z: FACE + 80 };
  step();
  log[1].sign.pages.push('tampered');
  player.pos = { x: 0, y: CASTLE.baseY, z: 1000 };
  step();
  player.pos = { x: 0, y: PORCH, z: FACE + 80 };
  step();
  assert.equal(log[3].sign.pages.length, 2);
});

test('enter(): a hero placed at the door does not set it off; it re-arms once he has walked away', () => {
  const { objects, door, player, log, step } = setup();
  step();
  objects.dialogOpen = true;
  assert.equal(objects.hero.valid, true);
  // Placed right in front of the door, facing it (an arrival).
  player.pos = { x: 0, y: PORCH, z: FACE + 80 };
  objects.enter(player);
  assert.equal(objects.hero.valid, false, 'his last tick elsewhere is forgotten');
  assert.equal(objects.dialogOpen, false);
  assert.equal(door.armed, false);
  step(30);
  assert.equal(log.length, 0, 'nothing where he arrives');
  player.pos = { x: 0, y: CASTLE.baseY, z: FACE + DOOR.REARM - 50 };
  step();
  assert.equal(door.armed, false, 'still near');
  player.pos = { x: 0, y: CASTLE.baseY, z: FACE + DOOR.REARM + 50 };
  step();
  assert.equal(door.armed, true);
  player.pos = { x: 0, y: PORCH, z: FACE + 80 };
  step();
  assert.equal(log.length, 2, 'walking back up works as ever');
  // Placed away from the door: it stays armed.
  player.pos = { x: 0, y: CASTLE.baseY, z: 1500 };
  step();
  assert.equal(door.armed, true);
  objects.enter(player);
  assert.equal(door.armed, true);
  // Without a door, enter() has nothing to disarm.
  const bare = new ObjectManager({ scene: new THREE.Scene(), collision: castleWorld(), events: new Events(), layout: { groundHeight: () => 0 }, player, fx: null });
  assert.equal(bare.door, null);
  bare.enter(player);
  assert.equal(bare.hero.valid, false);
});

// ---- doors that lead somewhere (Door.js) ------------------------------------------------

// A door with its own event log: [name, payload] per event.
function door(spec) {
  const events = new Events();
  const log = [];
  for (const name of ['sfx', 'signRead', 'warpRequest']) events.on(name, (e) => log.push([name, e]));
  return { door: new Door({ events, ...spec }), log };
}

const SOON = Object.freeze({ id: 'door_soon', pages: Object.freeze(['This door is still being built.', 'Come back after the next update!']) });

test('doors turned by their yaw: only in front of the face, within reach, facing it (or pushing)', () => {
  // Facing -Z (the inside of the hall's front door): Jonas walks in facing +Z.
  const south = { id: 'south', x: 0, z: 3000, yaw: Math.PI, width: 420, floorY: 0, to: 'grounds', entry: 'porch' };
  // Facing -X (a door in an east wall): Jonas walks in facing +X.
  const east = { id: 'east', x: 2144, z: -600, yaw: -Math.PI / 2, width: 300, floorY: 0, to: 'far', entry: 'arrival' };
  const cases = [
    [south, 0, 0, 2900, 0, true],
    [south, 0, 0, 3000 - DOOR.REACH + 10, 0.9, true], // at an angle within 60 degrees
    [south, 0, 0, 2900, Math.PI, false], // facing away
    [south, 0, 0, 2900, Math.PI / 2, false], // sideways
    [south, 0, 0, 3080, 0, false], // behind it
    [south, 210 + DOOR.SIDE_MARGIN + 20, 0, 2900, 0, false], // beside it
    [south, 0, 0, 3000 - DOOR.REACH - 30, 0, false], // too far
    [south, 0, DOOR.ABOVE + 20, 2900, 0, false], // too high
    [south, 0, -DOOR.BELOW - 20, 2900, 0, false], // too low
    [east, 2044, 0, -600, Math.PI / 2, true],
    [east, 2044, 0, -600 + 150 + DOOR.SIDE_MARGIN - 10, Math.PI / 2, true],
    [east, 2044, 0, -600, -Math.PI / 2, false],
    [east, 2044, 0, -600 + 150 + DOOR.SIDE_MARGIN + 20, Math.PI / 2, false],
    [east, 2200, 0, -600, Math.PI / 2, false],
    [east, 2144 - DOOR.REACH - 30, 0, -600, Math.PI / 2, false],
  ];
  for (const [spec, x, y, z, yaw, hit] of cases) {
    const { door: d } = door(spec);
    const p = fakePlayer(x, y, z, yaw);
    assert.equal(d.atDoor(p), hit, `${spec.id} at ${x}, ${y}, ${z} facing ${yaw}`);
    assert.equal(d.update(p), hit);
  }
  // Pushing against it counts at any angle; flying past, reading, dying or dropping in never.
  const { door: d } = door(east);
  const p = fakePlayer(2044, 0, -600, 0);
  assert.equal(d.atDoor(p), false);
  p.action = 'push';
  assert.equal(d.atDoor(p), true);
  for (const a of ['flying', 'reading', 'death', 'spawn']) {
    p.action = a;
    p.faceYaw = Math.PI / 2;
    assert.equal(d.atDoor(p), false, a);
  }
});

test('an open door creaks and asks for the warp once, then waits until he is off its apron', () => {
  const spec = { id: 'south', x: 0, z: 3000, yaw: Math.PI, width: 420, floorY: 0, to: 'grounds', entry: 'porch', kind: 'door' };
  const { door: d, log } = door(spec);
  const p = fakePlayer(0, 0, 2900, 0);
  assert.equal(d.update(p), true);
  assert.deepEqual(log.map(([n, e]) => (n === 'sfx' ? e.name : n)), ['door_open', 'warpRequest']);
  assert.deepEqual(log[0][1].pos, { x: 0, y: 300, z: 3000 });
  const w = log[1][1];
  assert.deepEqual([w.to, w.entry, w.kind, w.from], ['grounds', 'porch', 'door', d]);
  // Standing there, and anywhere on the apron: nothing more.
  for (let i = 0; i < 60; i++) d.update(p);
  p.pos = { x: 0, y: 0, z: 3000 - DOOR.REACH - DOOR.APRON + 10 };
  d.update(p);
  p.pos = { x: 210 + DOOR.SIDE_MARGIN + DOOR.APRON - 10, y: 0, z: 2900 };
  d.update(p);
  assert.equal(log.length, 2);
  assert.equal(d.armed, false);
  // Off the apron in front (well within REARM): armed again, and in once more.
  p.pos = { x: 0, y: 0, z: 3000 - DOOR.REACH - DOOR.APRON - 10 };
  d.update(p);
  assert.equal(d.armed, true);
  p.pos = { x: 0, y: 0, z: 2900 };
  d.update(p);
  assert.equal(log.length, 4);
  // ...or off it to the side.
  p.pos = { x: 210 + DOOR.SIDE_MARGIN + DOOR.APRON + 10, y: 0, z: 2900 };
  d.update(p);
  assert.equal(d.armed, true);
  assert.equal(d.triggers, 2);
});

test('sealed, an open door shows its sealed sign (with the laugh) and waits for REARM; locked ones their locked sign', () => {
  const spec = { id: 'castle', x: 0, z: -644, yaw: 0, width: 420, floorY: 300, to: 'hall', entry: 'front', locked: CASTLE_LOCKED, sealedSign: CASTLE_SEALED };
  const { door: d, log } = door(spec);
  const p = fakePlayer(0, 300, -544);
  assert.equal(d.update(p, true), true);
  assert.deepEqual(log.map(([n, e]) => (n === 'sfx' ? e.name : n)), ['evil_laugh', 'signRead']);
  assert.deepEqual(log[1][1].sign, { id: 'castle_sealed', pages: [...CASTLE_SEALED.pages], x: 0, z: -644, yaw: 0 });
  assert.deepEqual(CASTLE_SEALED.pages, ['The castle door is sealed shut...', 'The storm has sealed it!', 'Stop AI RACE and it will open again.']);
  // Off the apron is not enough after a message: REARM.
  p.pos = { x: 0, y: 160, z: -644 + DOOR.REACH + DOOR.APRON + 40 };
  d.update(p, false);
  assert.equal(d.armed, false);
  p.pos = { x: 0, y: 160, z: -644 + DOOR.REARM + 40 };
  d.update(p, false);
  assert.equal(d.armed, true);
  // No longer sealed: in.
  p.pos = { x: 0, y: 300, z: -544 };
  d.update(p, false);
  assert.equal(log.at(-1)[0], 'warpRequest');
  // A locked door shows its own sign, sealed or not; one without the laugh rattles in its frame
  // instead (its handle tried), at the door.
  for (const sealed of [false, true]) {
    const locked = door({ id: 'east', x: 0, z: 0, yaw: 0, to: null, locked: SOON, laugh: false });
    locked.door.update(fakePlayer(0, 0, 100), sealed);
    assert.deepEqual(locked.log.map(([n, e]) => (n === 'sfx' ? e.name : n)), ['door_rattle', 'signRead']);
    assert.deepEqual(locked.log[0][1].pos, locked.door.pos);
    assert.deepEqual(locked.log[1][1].sign.pages, [...SOON.pages]);
  }
});

test('disarm(): quiet until he has left the re-arm range in use; near() follows it', () => {
  const open = door({ id: 'south', x: 0, z: 3000, yaw: Math.PI, width: 420, floorY: 0, to: 'grounds', entry: 'porch' });
  const p = fakePlayer(0, 0, 3000 - 174, 0); // on the apron
  assert.equal(open.door.near(p), true);
  open.door.disarm();
  for (let i = 0; i < 20; i++) open.door.update(p);
  assert.equal(open.log.length, 0);
  p.pos.z = 3000 - DOOR.REACH - DOOR.APRON - 5;
  assert.equal(open.door.near(p), false);
  open.door.update(p);
  assert.equal(open.door.armed, true);
  // A locked door's range is REARM.
  const locked = door({ id: 'east', x: 0, z: 0, yaw: 0, to: null, locked: SOON });
  const q = fakePlayer(0, 0, DOOR.REARM - 20);
  assert.equal(locked.door.near(q), true);
  q.pos.z = DOOR.REARM + 20;
  assert.equal(locked.door.near(q), false);
  // reset() re-arms, back to the door's own range.
  open.door.update(fakePlayer(0, 0, 2900, 0), true); // (a sealed trigger: REARM)
  assert.equal(open.door.far, true);
  open.door.reset();
  assert.deepEqual([open.door.armed, open.door.far], [true, false]);
});

test('objects: the castle door with CASTLE.enter opens, sealed while AI RACE is on or fading; layout.DOORS join it', () => {
  const doors = [{ id: 'side', x: 1500, z: 0, yaw: -Math.PI / 2, width: 300, floorY: CASTLE.baseY, to: 'far', entry: 'arrival' }];
  const { objects, player, events, step } = setup({ CASTLE: { ...CASTLE, enter: { to: 'hall', entry: 'front' } }, DOORS: doors });
  const warps = [];
  events.on('warpRequest', (e) => warps.push(e.to));
  const signs = [];
  events.on('signRead', (e) => signs.push(e.sign.id));
  assert.equal(objects.doors.length, 2);
  assert.equal(objects.doors[0], objects.door);
  assert.ok(objects.doors[1] instanceof Door);
  assert.equal(objects.door.to, 'hall');
  const atCastle = () => {
    player.pos = { x: 0, y: CASTLE.baseY, z: 2000 };
    step();
    player.pos = { x: 0, y: PORCH, z: FACE + 80 };
    step();
  };
  atCastle();
  assert.deepEqual(warps, ['hall']);
  events.emit('darkMode', { on: true });
  objects.setDarkness(1);
  atCastle();
  assert.deepEqual(signs, ['castle_sealed']);
  events.emit('darkMode', { on: false });
  objects.setDarkness(0.4);
  atCastle();
  assert.deepEqual(signs, ['castle_sealed', 'castle_sealed'], 'still fading out');
  objects.setDarkness(0);
  atCastle();
  assert.deepEqual(warps, ['hall', 'hall']);
  // The layout's door, facing -X, works the same way.
  player.pos = { x: 1400, y: CASTLE.baseY, z: 0 };
  player.faceYaw = Math.PI / 2;
  step();
  assert.deepEqual(warps, ['hall', 'hall', 'far']);
  // enter() quiets the doors he stands at; reset() re-arms them all.
  objects.reset();
  objects.enter(player);
  assert.deepEqual(objects.doors.map((d) => d.armed), [true, false]);
  step(10);
  assert.equal(warps.length, 3);
  objects.reset();
  assert.deepEqual(objects.doors.map((d) => d.armed), [true, true]);
});

test('door check allocates nothing per tick while nothing happens', () => {
  const hot = {
    'CastleDoor.update': CastleDoor.prototype.update,
    'CastleDoor.atDoor': CastleDoor.prototype.atDoor,
    'CastleDoor.near': CastleDoor.prototype.near,
    'Door.update': Door.prototype.update,
    'Door.atDoor': Door.prototype.atDoor,
    'Door.near': Door.prototype.near,
  };
  for (const [name, fn] of Object.entries(hot)) {
    const src = fn.toString();
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, name);
  }
});

test('the warp timeline and the swinging door leaves allocate nothing per tick or frame', () => {
  // A bare area (no builders) for its setDoorOpen, and a door with no leaves for doorLeaves'.
  const area = buildArea(new THREE.Scene(), {
    name: 'bare',
    origin: { x: 0, y: 0, z: 0 },
    builders: [],
    layout: {},
    entries: { in: { x: 0, y: 0, z: 0 } },
    respawn: { entry: 'in', drop: 0 },
    waterLevelAt: () => NO_WATER,
    probeY: 100,
  });
  const hot = {
    'Area.setDoorOpen': area.setDoorOpen,
    'doorLeaves().setOpen': doorLeaves([], null, (g) => g, 'none').setOpen,
  };
  for (const name of ['step', '_step', '_swing', '_amount', 'wipe', 'heroScale', 'heroOffset', 'update', '_toward', '_approach', '_keepCarry', '_his', '_carried']) {
    assert.equal(typeof AreaSwitch.prototype[name], 'function', name);
    hot[`AreaSwitch.${name}`] = AreaSwitch.prototype[name];
  }
  for (const [name, fn] of Object.entries(hot)) {
    const src = fn.toString();
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, name);
  }
});
