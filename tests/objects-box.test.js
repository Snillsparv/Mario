// The mystery box and the winged hat in node: the floating box and its collider, a bump from
// below (also when the physics already stopped the hero at the underside), a punch, what does
// not count, the hat popping out, hovering above the box and gliding down beside it within
// reach, the pickup (player.giveWingHat(40) once), the 30 s recharge, reset(), the draw calls
// and the allocation rules of the hot paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { Events } from '../src/core/events.js';
import { PLAYER_HEIGHT } from '../src/core/constants.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { MysteryBox, BOX } from '../src/objects/MysteryBox.js';
import { buildPlaceholderWingedHat } from '../src/objects/wingedHat.js';

const SPOT = { x: 1000, z: 2000, y: 340, size: 130 };
const SIZE = 8000;

function flatWorld() {
  const w = new CollisionWorld();
  w.addTriangles([-SIZE, 0, SIZE, SIZE, 0, SIZE, SIZE, 0, -SIZE, -SIZE, 0, SIZE, SIZE, 0, -SIZE, -SIZE, 0, -SIZE]);
  w.finalize();
  return w;
}

function fakePlayer(x = 0, y = 0, z = 5000) {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    action: 'idle',
    faceYaw: Math.PI,
    coins: 0,
    stars: 0,
    hats: [],
    attack: null,
    giveWingHat(s) {
      this.hats.push(s);
    },
    getAttack() {
      return this.attack;
    },
    collectCoin() {},
    collectStar() {},
  };
}

function setup({ layout = {}, player = fakePlayer() } = {}) {
  const events = new Events();
  const log = [];
  events.on('sfx', (e) => log.push(e.name));
  const collision = flatWorld();
  const objects = new ObjectManager({
    scene: new THREE.Scene(),
    collision,
    events,
    layout: { MYSTERY_BOX: SPOT, groundHeight: () => 0, ...layout },
    player,
    buildHat: buildPlaceholderWingedHat,
  });
  let camera = null;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      objects.update({ player, camera });
      objects.animate(0, 1, null);
    }
  };
  const setCamera = (yaw) => {
    camera = { getYaw: () => yaw };
  };
  return { objects, box: objects.box, player, log, step, collision, events, setCamera };
}

// Puts the hero under the box, rising with vy, his head `gap` below the underside.
function under(player, box, gap, vy = 12) {
  player.pos = { x: box.x + 10, y: box.bottomY - PLAYER_HEIGHT - gap, z: box.z - 10 };
  player.vel = { x: 0, y: vy, z: 0 };
}

test('the box floats spot.y above the ground with a solid collider', () => {
  const { box, collision } = setup();
  assert.equal(box.bottomY, SPOT.y);
  assert.equal(box.topY, SPOT.y + SPOT.size);
  // (The collider stands where the box is drawn: bobbing at most BOB off its rest pose.)
  assert.ok(Math.abs(collision.findCeil(SPOT.x, 100, SPOT.z).y - SPOT.y) <= BOX.BOB, 'underside is a ceiling');
  assert.ok(Math.abs(collision.findFloor(SPOT.x, 600, SPOT.z).y - (SPOT.y + SPOT.size)) <= BOX.BOB, 'top is a floor');
  const w = collision.findWalls(SPOT.x + SPOT.size / 2 + 20, SPOT.y + 40, SPOT.z, 0, 40);
  assert.ok(w.walls.length > 0 && w.x > SPOT.x + SPOT.size / 2 + 20, 'sides push out');
  assert.equal(collision.findFloor(SPOT.x, 200, SPOT.z).y, 0, 'the ground below stays walkable');
});

test('a hero rising under it bumps it: box_hit, the hat pops out', () => {
  const { box, player, log, step } = setup();
  step(3);
  assert.equal(box.state, 'ready');
  under(player, box, 20);
  step();
  assert.equal(box.state, 'empty');
  assert.equal(box.hits, 1);
  assert.deepEqual(log.filter((n) => n === 'box_hit'), ['box_hit']);
  assert.equal(box.hat.state, 'pop');
  assert.equal(box.hatMesh.visible, true);
  // It jolts up and settles.
  step(2);
  assert.ok(box.offset > 5, `jolt ${box.offset}`);
  step(BOX.JOLT_TICKS);
  assert.equal(box.offset, 0);
  // Bumping the empty box does nothing.
  under(player, box, 5);
  step();
  assert.equal(box.hits, 1);
});

test('the bump counts on the tick the physics stopped him at the underside (vy already 0)', () => {
  const { box, player, step } = setup();
  under(player, box, 60, 30);
  step(); // rising, head still 60 below
  assert.equal(box.state, 'ready');
  player.pos.y = box.bottomY - PLAYER_HEIGHT; // head against the ceiling ...
  player.vel.y = 0; // ... and the physics zeroed his vy
  step();
  assert.equal(box.state, 'empty');
});

test('no bump when falling, standing, too far below or outside the footprint', () => {
  const { box, player, step } = setup();
  const cases = [
    [0, -8, 0], // falling
    [30, 12, 0], // head 30 below
    [0, 12, SPOT.size / 2 + BOX.BUMP_MARGIN + 5], // beside it
  ];
  for (const [gap, vy, dx] of cases) {
    player.pos = { x: box.x + dx, y: box.bottomY - PLAYER_HEIGHT - gap, z: box.z };
    player.vel = { x: 0, y: vy, z: 0 };
    step();
    player.pos = { x: 0, y: 0, z: 5000 };
    player.vel = { x: 0, y: 0, z: 0 };
    step(2);
  }
  // Standing on top and jumping.
  player.pos = { x: box.x, y: box.topY, z: box.z };
  player.vel = { x: 0, y: 30, z: 0 };
  step();
  assert.equal(box.state, 'ready');
  assert.equal(box.hits, 0);
});

// Where the box is drawn at the end of the latest tick (alpha 1): its underside and top.
function drawn(box) {
  const y = box.boxGroup.position.y;
  return { bottom: y - box.half, top: y + box.half };
}

test('the collider bobs and jolts with the box, one tick ahead of the picture', () => {
  const { box, player, step, collision } = setup();
  const at = () => ({ top: collision.findFloor(box.x, 1000, box.z).y, bottom: collision.findCeil(box.x, 0, box.z).y });
  let worst = 0;
  const check = () => {
    const c = at(); // what the next physics step collides with ...
    step(); // ... is where the box is drawn at the end of that tick
    const d = drawn(box);
    worst = Math.max(worst, Math.abs(c.top - d.top), Math.abs(c.bottom - d.bottom));
  };
  for (let i = 0; i < 60; i++) check(); // bobbing
  under(player, box, 5);
  for (let i = 0; i < BOX.JOLT_TICKS + 3; i++) check(); // the jolt
  assert.ok(box.hits === 1, 'bumped');
  assert.ok(worst < 1e-9, `off by ${worst}`);
  // It really moves (bob and jolt), and the walls go along.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 70; i++) {
    step();
    lo = Math.min(lo, box.lift);
    hi = Math.max(hi, box.lift);
  }
  assert.ok(hi - lo > BOX.BOB * 1.5, `bob ${lo}..${hi}`);
  const y = box.bottomY + box.lift + 1;
  const w = collision.findWalls(box.x + box.half + 20, y, box.z, 0, 40);
  assert.ok(w.walls.length > 0, 'the side walls follow');
  assert.equal(collision.findWalls(box.x + box.half + 20, box.topY + box.lift + 2, box.z, 0, 40).walls.length, 0, 'not above the top');
});

test('pounded from on top it dips under him instead of jumping up into his feet', () => {
  const { box, player, step } = setup();
  step();
  player.pos = { x: box.x, y: box.topY + box.lift, z: box.z };
  player.attack = { x: box.x, y: box.topY + box.lift, z: box.z, radius: 70, kind: 'pound' };
  step();
  player.attack = null;
  assert.equal(box.state, 'empty');
  step(3);
  assert.ok(box.offset < -5, `dips: ${box.offset}`);
  step(BOX.JOLT_TICKS);
  assert.equal(box.offset, 0);
  // From below it jumps up.
  const b2 = setup();
  under(b2.player, b2.box, 5);
  b2.step(3);
  assert.ok(b2.box.offset > 5);
});

test('a punch overlapping the box hits it too', () => {
  const { box, player, step } = setup();
  player.pos = { x: box.x + 150, y: box.bottomY - 20, z: box.z };
  player.attack = { x: box.x + 150, y: box.bottomY + 40, z: box.z, radius: 60, kind: 'punch' };
  step();
  assert.equal(box.state, 'ready', 'out of reach');
  player.attack = { x: box.x + 100, y: box.bottomY + 40, z: box.z, radius: 60, kind: 'punch' };
  step();
  assert.equal(box.state, 'empty');
  player.attack = null;
});

test('the hat hovers above the box, then glides down beside it toward the camera to chest height', () => {
  const { box, player, step, setCamera } = setup();
  setCamera(Math.PI); // the camera looks along -Z: it is on the +Z side
  under(player, box, 10);
  step();
  player.pos = { x: 0, y: 0, z: 5000 };
  player.vel.y = 0;
  step(BOX.HAT_POP_TICKS + 4);
  assert.equal(box.hat.state, 'hold');
  assert.ok(box.hat.y > box.topY + BOX.HAT_ABOVE - 10, 'above the box');
  assert.ok(Math.abs(box.hat.x - box.x) < 1 && Math.abs(box.hat.z - box.z) < 1);
  step(BOX.HAT_HOLD_TICKS + BOX.HAT_GLIDE_TICKS + 5);
  assert.equal(box.hat.state, 'hover');
  const H = box.hat;
  assert.ok(Math.abs(H.z - (box.z + BOX.HAT_OUT)) < 1 && Math.abs(H.x - box.x) < 1, `toward the camera: ${H.x}, ${H.z}`);
  assert.ok(H.y > 60 && H.y < 160, `chest height: ${H.y}`);
  assert.equal(player.hats.length, 0);
});

test('touching the hat calls giveWingHat(40) once; the box recharges for 30 s, then can be hit again', () => {
  const { box, player, step, log } = setup();
  under(player, box, 10);
  step();
  player.pos = { x: 0, y: 0, z: 5000 };
  player.vel.y = 0;
  step(BOX.HAT_POP_TICKS + BOX.HAT_HOLD_TICKS + BOX.HAT_GLIDE_TICKS + 10);
  const H = box.hat;
  player.pos = { x: H.x + 60, y: 0, z: H.z };
  step();
  assert.deepEqual(player.hats, [40]);
  assert.equal(box.hat.state, 'inside');
  assert.equal(box.hatMesh.visible, false);
  assert.equal(box.state, 'recharging');
  step(20);
  assert.deepEqual(player.hats, [40], 'only once');
  // Not before 30 s.
  under(player, box, 5);
  step();
  assert.equal(box.hits, 1);
  player.pos = { x: 0, y: 0, z: 5000 };
  player.vel.y = 0;
  step(BOX.RESPAWN_TICKS - 25);
  assert.equal(box.state, 'recharging');
  step(5);
  assert.equal(box.state, 'ready');
  under(player, box, 5);
  step();
  assert.equal(box.hits, 2);
  assert.equal(log.filter((n) => n === 'box_hit').length, 2);
});

test('the hat can be grabbed while it hovers above the box (a hero up there)', () => {
  const { box, player, step } = setup();
  under(player, box, 5);
  step();
  player.vel.y = 0;
  player.pos = { x: 0, y: 0, z: 5000 };
  step(BOX.HAT_POP_TICKS + 3);
  player.pos = { x: box.x, y: box.topY, z: box.z };
  step();
  assert.deepEqual(player.hats, [40]);
});

test('the hat glides to a clear side: not into a wall or water', () => {
  const events = new Events();
  const w = new CollisionWorld();
  w.addTriangles([-SIZE, 0, SIZE, SIZE, 0, SIZE, SIZE, 0, -SIZE, -SIZE, 0, SIZE, SIZE, 0, -SIZE, -SIZE, 0, -SIZE]);
  // Water on the +Z side of the box (where the camera would send it).
  w.setWaterLevelFn((x, z) => (z > SPOT.z + 100 ? 50 : -11000));
  w.finalize();
  const player = fakePlayer();
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision: w, events, layout: { MYSTERY_BOX: SPOT, groundHeight: () => 0 }, player, buildHat: buildPlaceholderWingedHat });
  const box = objects.box;
  under(player, box, 5);
  objects.update({ player, camera: { getYaw: () => Math.PI } });
  assert.ok(box.hat.toZ <= SPOT.z + 100, `dry side: ${box.hat.toX}, ${box.hat.toZ}`);
});

test('reset() lights the box again with the hat inside', () => {
  const { objects, box, player, step } = setup();
  under(player, box, 5);
  step();
  step(10);
  objects.reset();
  assert.equal(box.state, 'ready');
  assert.equal(box.hat.state, 'inside');
  assert.equal(box.hatMesh.visible, false);
  assert.equal(box.frontMat.map, box.textures.full);
  player.vel.y = 0;
  player.pos = { x: 0, y: 0, z: 5000 };
  step();
  under(player, box, 5);
  step();
  assert.equal(box.hits, 2);
});

test('draw calls: the box adds three; the hat only while it is out', () => {
  const drawn = (objects) => {
    let n = 0;
    objects.group.traverseVisible((o) => {
      if (o.isMesh && (o.count === undefined || o.count > 0)) n++;
    });
    return n;
  };
  const plain = new ObjectManager({ scene: new THREE.Scene(), collision: flatWorld(), events: new Events(), layout: { groundHeight: () => 0 }, player: fakePlayer() });
  plain.update({ player: plain.player });
  plain.animate(0, 1, null);
  const { objects, box, player, step } = setup();
  step();
  assert.equal(drawn(objects) - drawn(plain), 3, 'frame, crystal back and front');
  under(player, box, 5);
  step(3);
  assert.equal(drawn(objects) - drawn(plain), 3 + 3, 'plus the hat');
  // The default hat (the hero model's) is at most three draws too.
  const def = new MysteryBox({ spot: SPOT, collision: flatWorld(), events: new Events(), groundAt: () => 0 });
  let n = 0;
  def.hatMesh.traverse((o) => {
    if (o.isMesh) n++;
  });
  assert.ok(n >= 1 && n <= 3, `${n} hat meshes`);
});

test('mystery box hot paths avoid allocating constructs', () => {
  const hot = {
    'MysteryBox.update': MysteryBox.prototype.update,
    'MysteryBox.bumps': MysteryBox.prototype.bumps,
    'MysteryBox.struck': MysteryBox.prototype.struck,
    'MysteryBox._updateHat': MysteryBox.prototype._updateHat,
    'MysteryBox.touchesHat': MysteryBox.prototype.touchesHat,
    'MysteryBox.animate': MysteryBox.prototype.animate,
    'MysteryBox._liftAt': MysteryBox.prototype._liftAt,
    'MysteryBox._setLift': MysteryBox.prototype._setLift,
  };
  for (const [name, fn] of Object.entries(hot)) {
    const src = fn.toString();
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, name);
  }
});
