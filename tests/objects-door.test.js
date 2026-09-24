// The locked castle door in node: walking up to it (in front, close, on the porch, facing it)
// plays the evil laugh and opens the dialog with the castle_locked sign; nothing from the
// side, from behind, from too far, below the porch or facing away; once only until Pip has
// walked more than 500 away; the same in AI RACE mode; reset() re-arms it; the door face and
// porch height come from the collision world when it has them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { Events } from '../src/core/events.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { CastleDoor, DOOR, CASTLE_LOCKED } from '../src/objects/CastleDoor.js';

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

test('door check allocates nothing per tick while nothing happens', () => {
  for (const [name, fn] of Object.entries({ 'CastleDoor.update': CastleDoor.prototype.update, 'CastleDoor.atDoor': CastleDoor.prototype.atDoor })) {
    const src = fn.toString();
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
  }
});
