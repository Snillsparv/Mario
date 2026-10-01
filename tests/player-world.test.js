// Player side of areas: setWorld moves Jonas into another collision world (its respawn point
// and drop, its readable signs) and drops everything tied to the old place while keeping his
// health, coins and stars; placeAt puts him at an entry, standing or dropping in; beginIntro
// honours the spawn's own drop; the winged-hat flight's rim is the new world's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleDiff } from '../src/core/math.js';
import { Events } from '../src/core/events.js';
import { Player, signEntries } from '../src/player/Player.js';
import { CourseBuilder, createSim } from '../src/player/physics/testCourse.js';
import * as T from '../src/player/physics/tuning.js';
import { groundHeight } from '../src/world/layout.js';

// A course built by build(CourseBuilder) (which may return its signs): { world, signs }.
function area(build) {
  const b = new CourseBuilder();
  const built = build(b);
  return { world: b.build(), signs: Array.isArray(built) ? built : [] };
}

// Far from the origin, as the areas are: an island x 57000..63000, z -3000..3000.
const FAR = { x: 60000, half: 3000 };
const farIsland = (b) => b.floor(FAR.x - FAR.half, -FAR.half, FAR.x + FAR.half, FAR.half, 0);
const HOME = { x: FAR.x, y: 0, z: 2000, yaw: Math.PI };

test('setWorld: the new world, respawn point and signs; everything tied to the old place is dropped', () => {
  const s = createSim((b) => b.ground(3000));
  const p = s.p;
  p.giveWingHat();
  Object.assign(p, {
    readingSign: {}, pressGuard: true, cannon: { phase: 'aim' }, cannonSafeUntil: 999, tailGrip: {}, tailSpeed: 0.3, tailRelease: 0.2,
    invincibleUntil: 999, drownTicks: 100, breath: 0.4, comboJump: { fv: 40, y: 0 }, grabCooldownUntil: 999, letGoPole: {},
    walkOff: {}, flightFall: true, stompBounce: true, wall: {}, wallTouchTick: 3, health: 5, coins: 12, stars: 2,
  });
  p.jumpChain.kind = 'double';
  p.jumpChain.landedAt = 3;
  const far = area(farIsland);
  p.setWorld({ collision: far.world, spawn: { ...HOME, drop: 400 }, signs: far.signs });

  assert.equal(p.collision, far.world);
  assert.deepEqual(p.spawn, { ...HOME, drop: 400 });
  assert.deepEqual(p.signs, []);
  const cleared = {
    readingSign: null, pressGuard: false, cannon: null, cannonSafeUntil: 0, tailGrip: null, tailSpeed: 0, tailRelease: -1,
    invincibleUntil: 0, drownTicks: 0, breath: 1, comboJump: null, grabCooldownUntil: 0, letGoPole: null, walkOff: null,
    flightFall: false, stompBounce: false, wall: null, wallTouchTick: -Infinity, wingHat: 0,
  };
  for (const [key, value] of Object.entries(cleared)) assert.equal(p[key], value, key);
  assert.deepEqual(p.jumpChain, { kind: null, landedAt: -Infinity });
  assert.deepEqual(s.events('wingHat').map((e) => e.on), [true, false], 'the hat comes off');
  assert.deepEqual({ health: p.health, coins: p.coins, stars: p.stars }, { health: 5, coins: 12, stars: 2 }, 'kept');
  // Without a hat on, nothing more is emitted.
  p.setWorld({ collision: far.world, spawn: HOME });
  assert.equal(s.events('wingHat').length, 2);
  assert.equal(p.spawn.drop, undefined);
});

test('placeAt: standing at the entry, or dropping in from above it', () => {
  const s = createSim((b) => b.ground(3000));
  const p = s.p;
  const far = area(farIsland);
  p.setWorld({ collision: far.world, spawn: HOME });
  p.placeAt({ x: FAR.x, y: 0, z: 500, yaw: Math.PI / 2 });
  assert.equal(p.action, 'idle');
  assert.ok(p.grounded, 'on the new world\'s floor');
  assert.deepEqual({ ...p.pos }, { x: FAR.x, y: 0, z: 500 });
  assert.deepEqual({ ...p.prevPos }, { ...p.pos }, 'no interpolation smear');
  assert.equal(p.faceYaw, Math.PI / 2);
  s.run(20, {});
  assert.equal(p.action, 'idle');
  assert.deepEqual({ ...p.pos }, { x: FAR.x, y: 0, z: 500 }, 'stands still');

  p.placeAt({ x: FAR.x + 100, y: 0, z: 0, yaw: 0, drop: 600 });
  assert.equal(p.action, 'spawn');
  assert.equal(p.pos.y, 600);
  assert.ok(!p.grounded);
  const n = s.until(120, {}, (pp) => pp.action !== 'spawn');
  assert.ok(n < 120, 'lands');
  assert.ok(p.grounded && p.pos.y === 0, `on the floor below (${p.pos.y})`);
  assert.equal(s.events('hurt').length, 0, 'a drop-in never hurts');
});

test('beginIntro and the respawn drop from the spawn\'s own height (INTRO_DROP by default)', () => {
  const far = area(farIsland);
  const p = new Player({ collision: far.world, events: new Events(), spawn: { ...HOME, drop: 250 }, signs: [] });
  assert.equal(p.spawn.drop, 250, 'the constructor keeps it');
  p.beginIntro();
  assert.equal(p.action, 'spawn');
  assert.deepEqual({ ...p.pos }, { x: HOME.x, y: 250, z: HOME.z });
  p.setWorld({ collision: far.world, spawn: { ...HOME, drop: 400 } });
  p.teleport(FAR.x, 0, 0);
  p.loseLife();
  assert.deepEqual({ ...p.pos }, { x: HOME.x, y: 400, z: HOME.z }, 'a lost life drops in at the new respawn point');
  assert.equal(p.faceYaw, HOME.yaw);
  p.setWorld({ collision: far.world, spawn: HOME });
  p.beginIntro();
  assert.equal(p.pos.y, T.INTRO_DROP);
});

test('signs come from the new list; a sign without y stands on groundAt', () => {
  const OLD = { x: 0, z: 1000 };
  const NEW = { x: 600, z: 1000 };
  const s = createSim((b) => {
    b.ground(30000);
    return [b.sign(OLD.x, OLD.z, Math.PI, 0, ['Old sign'])];
  });
  const p = s.p;
  const next = area((b) => {
    b.ground(30000);
    return [b.sign(NEW.x, NEW.z, Math.PI, 0, ['New sign'])];
  });
  p.setWorld({ collision: next.world, spawn: { x: 0, y: 0, z: 0 }, signs: next.signs });
  const readAt = (x) => {
    p.placeAt({ x, y: 0, z: 900, yaw: 0 });
    s.run(2, {});
    const before = s.events('signRead').length;
    s.run(1, { B: true });
    const read = s.events('signRead').slice(before);
    s.run(1, {});
    p.endReading();
    s.run(20, {});
    return read.map((e) => e.sign.pages[0]);
  };
  assert.deepEqual(readAt(OLD.x), [], 'the old sign is not there any more');
  assert.deepEqual(readAt(NEW.x), ['New sign']);

  const signs = [{ id: 'a', x: 10, z: 20, yaw: 1, pages: ['A'] }, { id: 'b', x: 30, z: 40, y: 75, pages: ['B'] }];
  p.setWorld({ collision: next.world, spawn: { x: 0, y: 0, z: 0 }, signs, groundAt: (x, z) => x + z });
  assert.deepEqual(p.signs.map((e) => [e.sign.id, e.x, e.y, e.z, e.yaw]), [['a', 10, 30, 20, 1], ['b', 30, 75, 40, 0]]);
  assert.deepEqual(signEntries(signs.slice(0, 1))[0].y, groundHeight(10, 20), 'default: the grounds layout');
});

test('the winged-hat flight turns at the new world\'s rim, not the old one\'s', () => {
  const s = createSim((b) => b.ground(3000)); // the old world: an island round the origin
  const p = s.p;
  const far = area(farIsland);
  p.setWorld({ collision: far.world, spawn: { x: FAR.x, y: 0, z: 0 } });
  for (const yaw of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {
    p.placeAt({ x: FAR.x, y: 2500, z: 0, yaw });
    p.giveWingHat(40);
    p.setAction('flying');
    p.actionTimer = T.FLY_LAUNCH_TICKS;
    p.flySpeed = 60;
    p.flyPitch = T.FLY_GLIDE_PITCH;
    let turned = false;
    s.run(300, {}, (pp) => {
      const { x, z } = pp.pos;
      assert.ok(Math.abs(x - FAR.x) <= FAR.half && Math.abs(z) <= FAR.half, `left the far island at ${x.toFixed(0)}, ${z.toFixed(0)}`);
      if (Math.abs(angleDiff(yaw, pp.faceYaw)) > 2) turned = true;
      return pp.action === 'flying';
    });
    assert.ok(turned || p.action !== 'flying', `turned for home (yaw ${yaw.toFixed(2)})`);
  }
});
