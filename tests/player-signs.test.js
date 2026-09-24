// Reading signs (docs/ARCHITECTURE.md "Signs and dialog"): B in front of a sign's face, facing
// it, enters 'reading' and emits 'signRead' instead of punching; player.endReading() hands
// control back without the closing press turning into a punch or a jump.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/player/physics/testCourse.js';
import { Player } from '../src/player/Player.js';
import { SIGNS, groundHeight } from '../src/world/layout.js';
import { angleDiff } from '../src/core/math.js';
import * as T from '../src/player/physics/tuning.js';

const DEG = Math.PI / 180;

// A flat course with one sign at (0, 1000) whose face looks toward -Z (yaw PI). Pip stands at
// (x, z) facing `yaw`.
function atSign(x, z, yaw) {
  const s = createSim((b) => {
    b.ground(30000);
    return [b.sign(0, 1000, Math.PI, 0, ['Page one', 'Page two'])];
  }, { x, y: 0, z, yaw });
  s.run(2, {});
  return s;
}

const reads = (s) => s.events('signRead');
const punches = (s) => s.sfx().filter((n) => /^(punch[12]?|kick|jump_kick)$/.test(n));

describe('reading signs', () => {
  test('B in front of the face, facing it, reads instead of punching', () => {
    const s = atSign(0, 900, 0);
    s.run(1, { B: true });
    assert.equal(s.p.action, 'reading');
    assert.equal(s.p.anim, 'idle');
    assert.equal(s.p.forwardVel, 0);
    assert.equal(reads(s).length, 1);
    assert.deepEqual(reads(s)[0].sign.pages, ['Page one', 'Page two']);
    assert.equal(punches(s).length, 0);
  });

  test('from behind, beside, too far or facing away, B still punches', () => {
    const cases = [
      ['behind', 0, 1100, Math.PI],
      ['beside (+X)', 120, 1000, -Math.PI / 2],
      ['beside (-X)', -120, 1000, Math.PI / 2],
      ['almost beside', 120, 990, -Math.PI / 2],
      ['too far', 0, 1000 - T.SIGN_REACH - 20, 0],
      ['facing away', 0, 900, Math.PI],
      ['facing 90 deg off', 0, 900, Math.PI / 2],
    ];
    for (const [name, x, z, yaw] of cases) {
      const s = atSign(x, z, yaw);
      s.run(1, { B: true });
      assert.equal(s.p.action, 'punch', name);
      assert.equal(reads(s).length, 0, name);
    }
  });

  test('reads from an angle within reach, turning to face the board', () => {
    // 60 deg off the face's axis, facing 60 deg away from the board.
    const x = -Math.sin(60 * DEG) * 110;
    const z = 1000 - Math.cos(60 * DEG) * 110;
    const toBoard = Math.atan2(0 - x, 1000 - z);
    const s = atSign(x, z, toBoard + 60 * DEG);
    s.run(1, { B: true });
    assert.equal(s.p.action, 'reading');
    s.run(10, {});
    assert.ok(Math.abs(angleDiff(s.p.faceYaw, toBoard)) < 1e-6, 'turned to the board');
  });

  test('B while walking or running up to a sign reads it and stops', () => {
    const s = createSim((b) => {
      b.ground(30000);
      return [b.sign(0, 1000, Math.PI)];
    });
    s.until(60, { stickY: 1 }, (p) => p.pos.z > 1000 - T.SIGN_REACH + 20);
    assert.equal(s.p.action, 'walking');
    s.run(1, { stickY: 1, B: true });
    assert.equal(s.p.action, 'reading');
    assert.equal(s.p.forwardVel, 0);
    assert.equal(punches(s).length, 0);
    assert.ok(!s.sfx().includes('dive'));
  });

  test('while reading, the controller is ignored', () => {
    const s = atSign(0, 900, 0);
    s.run(1, { B: true });
    const { x, z } = s.p.pos;
    s.run(1, { stickX: 1, B: true });
    s.run(1, { stickY: -1, A: true });
    s.run(1, { Z: true });
    s.run(30, { stickX: -1, stickY: 1, A: true, B: true, Z: true });
    assert.equal(s.p.action, 'reading');
    assert.deepEqual([s.p.pos.x, s.p.pos.z], [x, z]);
    assert.equal(punches(s).length, 0);
    assert.ok(!s.sfx().includes('jump'));
    assert.equal(reads(s).length, 1, 'one signRead per read');
  });

  test('endReading restores control; the closing press neither punches nor jumps', () => {
    const s = atSign(0, 900, 0);
    s.run(1, { B: true });
    s.run(3, {});
    // The dialog box closes on a fresh B press: main calls endReading and flushes its input,
    // but even a press that still reaches the Player on that tick does nothing.
    s.p.endReading();
    assert.equal(s.p.action, 'idle');
    s.run(1, { B: true });
    assert.equal(s.p.action, 'idle');
    assert.equal(punches(s).length, 0);
    assert.equal(reads(s).length, 1, 'no second read from the closing press');
    s.run(1, {});
    s.p.endReading(); // not reading: a no-op
    s.run(1, { A: true });
    assert.equal(s.p.action, 'jump', 'a fresh press after closing works');
    s.until(60, {}, (p) => p.action === 'idle');
    s.run(1, {});
    s.run(1, { B: true });
    assert.equal(s.p.action, 'reading', 'the sign can be read again');
    s.p.endReading();
    s.run(1, {});
    s.run(10, { stickY: -1 });
    assert.equal(s.p.action, 'walking', 'walks off');
    assert.ok(s.p.pos.z < 900);
  });

  test('a jump press on the closing tick does not jump either', () => {
    const s = atSign(0, 900, 0);
    s.run(1, { B: true });
    s.run(2, {});
    s.p.endReading();
    s.run(1, { A: true });
    assert.equal(s.p.action, 'idle');
    assert.ok(!s.sfx().includes('jump'));
  });

  test('crouching, mid-punch and airborne B presses never read', () => {
    const crouched = atSign(0, 900, 0);
    crouched.run(2, { Z: true });
    crouched.run(1, { Z: true, B: true });
    assert.equal(crouched.p.action, 'crouch');
    assert.equal(reads(crouched).length, 0);

    // A punch thrown facing away; turned to the board mid-punch, B only queues the next hit.
    const punching = atSign(0, 900, Math.PI);
    punching.run(1, { B: true });
    assert.equal(punching.p.action, 'punch');
    punching.p.faceYaw = 0; // now facing the board mid-punch
    punching.run(3, {});
    punching.run(1, { B: true });
    assert.equal(punching.p.action, 'punch');
    assert.equal(reads(punching).length, 0);

    const air = atSign(0, 900, 0);
    air.run(1, { A: true });
    air.run(3, { A: true });
    air.run(1, { A: true, B: true });
    assert.equal(reads(air).length, 0);
    assert.notEqual(air.p.action, 'reading');
  });

  test('respawn, damage and death end the reading', () => {
    const s = atSign(0, 900, 0);
    s.run(1, { B: true });
    s.p.respawn();
    assert.equal(s.p.action, 'spawn');
    s.until(200, {}, (p) => p.action === 'idle');
    assert.equal(s.p.action, 'idle');

    const h = atSign(0, 900, 0);
    h.run(1, { B: true });
    h.p.takeDamage(1, { x: 0, y: 0, z: 1000 });
    assert.equal(h.p.action, 'hurt');
    h.p.endReading(); // the box closing later must not yank him out of the knockback
    assert.equal(h.p.action, 'hurt');

    const d = atSign(0, 900, 0);
    d.run(1, { B: true });
    d.p.loseHealth(8);
    assert.equal(d.p.action, 'death');
  });

  test('a sign on a different level (far above or below) is out of reach', () => {
    const s = createSim((b) => {
      b.ground(30000);
      return [b.sign(0, 1000, Math.PI, 400)];
    }, { x: 0, y: 0, z: 900, yaw: 0 });
    s.run(2, {});
    s.run(1, { B: true });
    assert.equal(s.p.action, 'punch');
  });
});

describe('layout signs', () => {
  test('the Player reads layout.SIGNS by default, standing at the ground height', () => {
    assert.ok(SIGNS.length > 0);
    const flatWorld = createSim((b) => b.ground(30000)).world;
    const p = new Player({ collision: flatWorld, events: null, spawn: { x: 0, y: 0, z: 0 } });
    assert.equal(p.signs.length, SIGNS.length);
    for (const [i, e] of p.signs.entries()) {
      assert.equal(e.sign, SIGNS[i]);
      assert.equal(e.y, groundHeight(SIGNS[i].x, SIGNS[i].z));
    }
    const none = new Player({ collision: flatWorld, events: null, spawn: { x: 0, y: 0, z: 0 }, signs: [] });
    assert.equal(none.signs.length, 0);
  });
});
