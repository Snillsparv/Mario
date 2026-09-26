// core/input keyboard stick ease-in (round-2 feedback: starting to run felt too intense on a
// keyboard, whose digital keys slammed the stick to full at once; round 3: the start still
// felt "hard", too long before the run: the ramp is shorter and the start curve brisker).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Input, KEY_RAMP_GRACE, KEY_RAMP_START, KEY_RAMP_TICKS, padLayout } from '../src/core/input.js';
import { Player } from '../src/player/Player.js';
import { CourseBuilder } from '../src/player/physics/testCourse.js';

function keyboard() {
  const target = new EventTarget();
  const input = new Input(target);
  input.getGamepads = () => [];
  const key = (type, code) => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code }));
  return { input, down: (code) => key('keydown', code), up: (code) => key('keyup', code) };
}

const polls = (input, n) => Array.from({ length: n }, () => input.poll());

describe('keyboard stick ease-in', () => {
  test('a direction key from rest eases the stick in over ~0.23 s', () => {
    const { input, down } = keyboard();
    input.poll();
    down('KeyW');
    const mags = polls(input, KEY_RAMP_TICKS + 3).map((c) => c.stickMag);
    assert.ok(Math.abs(mags[0] - KEY_RAMP_START) < 0.02, `first poll ${mags[0]}`);
    assert.ok(mags[0] >= 0.3, 'the first poll already moves the hero (intended speed > 0.5)');
    for (let i = 1; i < KEY_RAMP_TICKS; i++) {
      assert.ok(mags[i] > mags[i - 1], `rising at ${i}`);
      if (i >= 2) assert.ok(mags[i] - mags[i - 1] > mags[i - 1] - mags[i - 2] - 1e-12, `ease-in at ${i}`);
    }
    assert.ok(mags[2] < 0.5, `still light after 3 polls: ${mags[2]}`);
    assert.ok(KEY_RAMP_TICKS <= 8, 'full push within ~0.25 s');
    assert.equal(mags[KEY_RAMP_TICKS - 1], 1);
    assert.equal(mags[KEY_RAMP_TICKS + 2], 1);
  });

  test('turning while keys are held is immediate and keeps the magnitude', () => {
    const { input, down, up } = keyboard();
    down('KeyW');
    polls(input, 3);
    const before = input.poll();
    up('KeyW');
    down('KeyD');
    const turned = input.poll();
    assert.equal(turned.stickX > 0 && turned.stickY === 0, true, 'faces the new key at once');
    assert.ok(turned.stickMag > before.stickMag, `no restart: ${turned.stickMag} after ${before.stickMag}`);
    down('KeyW'); // diagonal
    const diag = input.poll();
    assert.ok(Math.abs(diag.stickX - diag.stickY) < 1e-12 && diag.stickMag > turned.stickMag);
  });

  test('release is immediate; a quick re-press carries on, a later one eases in again', () => {
    const { input, down, up } = keyboard();
    down('KeyW');
    polls(input, KEY_RAMP_TICKS);
    up('KeyW');
    assert.equal(input.poll().stickMag, 0, 'let go: neutral at once');
    down('KeyS'); // e.g. reversing for a turnaround, one poll later
    const back = input.poll();
    assert.equal(back.stickMag, 1);
    assert.ok(back.stickY < 0);
    up('KeyS');
    polls(input, KEY_RAMP_GRACE + 1);
    down('KeyS');
    assert.ok(Math.abs(input.poll().stickMag - KEY_RAMP_START) < 0.02, 'eases in again from rest');
  });

  test('Q still walks slowly (eased in to 0.45)', () => {
    const { input, down } = keyboard();
    down('KeyQ');
    down('KeyA');
    const mags = polls(input, KEY_RAMP_TICKS + 2).map((c) => c.stickMag);
    assert.ok(mags[0] < 0.2 && mags[0] > 0.125, `first ${mags[0]}`);
    assert.ok(Math.abs(mags[mags.length - 1] - 0.45) < 1e-12);
  });

  test('gamepad sticks and test overrides keep their exact value', () => {
    const { input } = keyboard();
    const axes = [0, -0.6, 0, 0];
    input.getGamepads = () => [{ connected: true, mapping: 'standard', axes, buttons: [], timestamp: 0 }];
    const c = input.poll();
    assert.ok(Math.abs(c.stickMag - (0.6 - 0.18) / 0.82) < 1e-9, `pad ${c.stickMag}`);
    input.getGamepads = () => [];
    input.setOverride({ stickY: 1 });
    assert.equal(input.poll().stickMag, 1);
  });

  // Round 3: the run shows by ~0.37 s and full speed comes by ~1.3 s (was ~0.63 s / ~1.6 s),
  // after a few ticks of tiptoe; the ramp never holds the start curve back.
  test('from the keyboard the hero tiptoes briefly, walks, then runs by ~0.37 s and reaches 32 by ~1.3 s', () => {
    const b = new CourseBuilder();
    b.ground(30000);
    const p = new Player({ collision: b.build(), events: null, spawn: { x: 0, y: 0, z: 0, yaw: 0 }, signs: [] });
    const { input, down } = keyboard();
    p.update(input.poll(), 0);
    down('KeyW');
    const anims = [];
    const first = {};
    let t32 = -1;
    let prev = 0;
    for (let i = 1; i <= 70; i++) {
      const c = input.poll();
      p.update(c, 0);
      if (anims[anims.length - 1] !== p.anim) anims.push(p.anim);
      first[p.anim] ??= i;
      if (i === 1) assert.equal(p.action, 'walking', 'moves on the first tick');
      if (i === 1) assert.ok(p.forwardVel < 3.5, `a light first step: ${p.forwardVel}`);
      if (i <= 12) assert.ok(c.stickMag * c.stickMag * 32 >= p.forwardVel, `tick ${i}: the eased stick never caps the start curve`);
      // Smooth: the speed gains at most 2 per tick and never jumps from one tick to the next.
      if (i > 1) assert.ok(p.forwardVel - prev <= 2 && p.forwardVel >= prev, `tick ${i}: ${prev} -> ${p.forwardVel}`);
      prev = p.forwardVel;
      if (t32 < 0 && p.forwardVel >= 32) t32 = i;
    }
    assert.deepEqual(anims, ['tiptoe', 'walk', 'run']);
    assert.ok(first.walk >= 4 && first.walk <= 6, `tiptoes for ${first.walk - 1} ticks`);
    assert.ok(first.run >= 10 && first.run <= 12, `runs from tick ${first.run}`);
    assert.ok(t32 >= 36 && t32 <= 40, `32 after ${t32} ticks`);
  });
});

// Round-2 review: the ease-in must only soften starting to run from rest.
describe('keyboard full push (rawStickMag)', () => {
  test("the snapshot carries the keys' full push while the stick eases in", () => {
    const { input, down, up } = keyboard();
    assert.equal(input.poll().rawStickMag, 0, 'neutral');
    down('KeyS');
    const first = input.poll();
    assert.ok(first.stickMag < 0.5 && first.rawStickMag === 1, `${first.stickMag} / ${first.rawStickMag}`);
    down('KeyQ');
    assert.equal(input.poll().rawStickMag, 0.45, 'Q: the slow walk is the full push');
    up('KeyQ');
    up('KeyS');
    assert.equal(input.poll().rawStickMag, 0, 'released');
    const axes = [0.7, 0, 0, 0];
    input.getGamepads = () => [{ connected: true, mapping: 'standard', axes, buttons: [], timestamp: 0 }];
    const pad = input.poll();
    assert.equal(pad.rawStickMag, pad.stickMag, 'a pad stick is its own full push');
    input.getGamepads = () => [];
    input.setOverride({ stickX: 0.3 });
    assert.ok(Math.abs(input.poll().rawStickMag - 0.3) < 1e-12, 'overrides too');
  });

  const pool = () => {
    const b = new CourseBuilder();
    const hole = { x0: -1000, z0: -3000, x1: 1000, z1: -500 };
    b.ground(30000, 0, hole);
    b.pool({ ...hole, y0: -700, level: -60, bank: 1000 });
    return b.build();
  };

  // Floats at the surface after walking in with S, then waits `rest` polls with no key held.
  function floating(rest = 12) {
    const p = new Player({ collision: pool(), events: null, spawn: { x: 0, y: 0, z: 0, yaw: Math.PI }, signs: [] });
    const kb = keyboard();
    kb.down('KeyS');
    for (let i = 0; i < 150 && !p.inWater; i++) p.update(kb.input.poll(), 0);
    kb.up('KeyS');
    for (let i = 0; i < rest; i++) p.update(kb.input.poll(), 0);
    assert.equal(p.action, 'water_surface');
    return { p, ...kb };
  }

  test('S / W with jump at the water surface jump out / dive at once, as with the stick', () => {
    for (const lead of [0, 2, 4]) {
      const { p, input, down } = floating();
      down('KeyS');
      for (let i = 0; i < lead; i++) p.update(input.poll(), 0);
      down('Space');
      p.update(input.poll(), 0);
      assert.equal(p.action, 'water_jump', `S held ${lead} polls before jump`);
    }
    const { p, input, down } = floating();
    down('KeyW');
    down('Space');
    p.update(input.poll(), 0);
    assert.equal(p.action, 'swim_stroke');
    assert.ok(!p.atSurface && p.swimPitch > 0.5, 'dives under');
  });

  test('a key pressed again while still moving picks up at once (no speed dip)', () => {
    const b = new CourseBuilder();
    b.ground(30000);
    const p = new Player({ collision: b.build(), events: null, spawn: { x: 0, y: 0, z: 0, yaw: 0 }, signs: [] });
    const { input, down, up } = keyboard();
    down('KeyW');
    for (let i = 0; i < 60; i++) p.update(input.poll(), 0);
    assert.equal(p.forwardVel, 32);
    up('KeyW');
    for (let i = 0; i <= KEY_RAMP_GRACE; i++) p.update(input.poll(), 0); // the ease-in restarts
    const atPress = p.forwardVel;
    assert.ok(atPress > 8, `still moving at ${atPress}`);
    down('KeyW');
    let prev = atPress;
    for (let i = 0; i < 12; i++) {
      p.update(input.poll(), 0);
      assert.ok(p.forwardVel > prev, `speeds up at once (tick ${i}: ${p.forwardVel} after ${prev})`);
      prev = p.forwardVel;
    }
  });

  test('a stick zeroed on the way (first-person look) is no push at all', () => {
    const b = new CourseBuilder();
    b.ground(30000);
    const p = new Player({ collision: b.build(), events: null, spawn: { x: 0, y: 0, z: 0, yaw: 0 }, signs: [] });
    const { input, down } = keyboard();
    down('KeyW');
    for (let i = 0; i < 40; i++) p.update(input.poll(), 0);
    const c = input.poll();
    p.update({ ...c, stickX: 0, stickY: 0, stickMag: 0 }, 0); // what CameraController.playerInput does
    assert.equal(p.intendedMag, 0);
    assert.equal(p.rawStickY, 0);
    assert.ok(!p.stickHeld);
  });
});

// Gamepad face buttons by layout (core/input.js padLayout): an Xbox-style standard pad jumps
// with the bottom button; a Nintendo-style pad (standard mapping, Nintendo id) and a pad without
// the standard mapping (read in the Switch's own order: Y left, B bottom, A right, X top) jump
// with the button on the right (labelled A) and attack with the bottom one (labelled B).
describe('gamepad face buttons', () => {
  const pad = (mapping, id, down) => ({
    connected: true,
    mapping,
    id,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })),
    timestamp: 1,
  });
  const read = (p) => {
    const input = new Input(new EventTarget());
    input.getGamepads = () => [p];
    const c = input.poll();
    return { A: c.A.down, B: c.B.down, CU: c.CU.down, CD: c.CD.down };
  };
  const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)';
  const PRO = 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)';
  const RAW = 'USB Gamepad (Vendor: 0f0d Product: 0092)';

  test('padLayout tells the three apart', () => {
    assert.equal(padLayout(pad('standard', XBOX, [])), 'standard');
    assert.equal(padLayout(pad('standard', PRO, [])), 'nintendo');
    assert.equal(padLayout(pad('', RAW, [])), 'raw');
    assert.equal(padLayout(pad('', 'Some Generic Joystick', [])), 'raw');
  });

  test('Xbox-style: bottom jumps, right or left attacks', () => {
    assert.deepEqual(read(pad('standard', XBOX, [0])), { A: true, B: false, CU: false, CD: false });
    assert.deepEqual(read(pad('standard', XBOX, [1])), { A: false, B: true, CU: false, CD: false });
    assert.deepEqual(read(pad('standard', XBOX, [2])), { A: false, B: true, CU: false, CD: false });
  });

  test('Nintendo-style with the standard mapping: right (A) jumps, bottom (B) attacks', () => {
    assert.deepEqual(read(pad('standard', PRO, [1])), { A: true, B: false, CU: false, CD: false });
    assert.deepEqual(read(pad('standard', PRO, [0])), { A: false, B: true, CU: false, CD: false });
    assert.deepEqual(read(pad('standard', PRO, [2])), { A: false, B: false, CU: false, CD: false }, 'left does nothing');
  });

  test('a pad without the standard mapping, in the Switch order: right (A) jumps, bottom (B) attacks, left and top do nothing', () => {
    assert.deepEqual(read(pad('', RAW, [2])), { A: true, B: false, CU: false, CD: false });
    assert.deepEqual(read(pad('', RAW, [1])), { A: false, B: true, CU: false, CD: false });
    assert.deepEqual(read(pad('', RAW, [0])), { A: false, B: false, CU: false, CD: false });
    assert.deepEqual(read(pad('', RAW, [3])), { A: false, B: false, CU: false, CD: false });
    // Home and Capture (12, 13 in that order) are no camera buttons.
    assert.deepEqual(read(pad('', RAW, [12, 13])), { A: false, B: false, CU: false, CD: false });
  });
});
