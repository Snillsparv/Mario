// core/input: the phone controller's state (setRemoteState, net/RemotePad.js) is a separate
// channel merged into the virtual controller exactly like the touch state.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';

function makeInput(pads = []) {
  const target = new EventTarget();
  const input = new Input(target);
  input.getGamepads = () => pads;
  const key = (type, code) => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code }));
  return { input, down: (code) => key('keydown', code), up: (code) => key('keyup', code) };
}

const pad = (axes = [0, 0, 0, 0], pressed = []) => ({
  connected: true,
  mapping: 'standard',
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
});

describe('remote (phone) state merge', () => {
  test('the phone stick drives the controller with its exact value', () => {
    const { input } = makeInput();
    input.setRemoteState({ stickX: -0.6, stickY: 0.8 });
    const c = input.poll();
    assert.equal(c.stickX, -0.6);
    assert.equal(c.stickY, 0.8);
    assert.ok(Math.abs(c.stickMag - 1) < 1e-12);
    assert.ok(Math.abs(c.rawStickMag - 1) < 1e-12, 'no keyboard ease-in for the phone stick');
  });

  test('null releases everything the phone held', () => {
    const { input } = makeInput();
    input.setRemoteState({ stickX: 1, stickY: 0, A: true, Z: true });
    assert.equal(input.poll().A.down, true);
    input.setRemoteState(null);
    const c = input.poll();
    assert.equal(c.stickMag, 0);
    assert.equal(c.A.down, false);
    assert.equal(c.A.released, true);
    assert.equal(c.Z.down, false);
    assert.equal(input.poll().A.released, false, 'released once');
  });

  test('out-of-range and junk values are clamped / ignored', () => {
    const { input } = makeInput();
    input.setRemoteState({ stickX: -7, stickY: 'x', START: 1 });
    const c = input.poll();
    assert.equal(c.stickX, -1);
    assert.equal(c.stickY, 0);
    assert.equal(c.START.pressed, true);
  });

  test('buttons give pressed / held / released edges', () => {
    const { input } = makeInput();
    input.setRemoteState({ B: true });
    assert.deepEqual(input.poll().B, { down: true, pressed: true, released: false });
    assert.deepEqual(input.poll().B, { down: true, pressed: false, released: false });
    input.setRemoteState({});
    assert.deepEqual(input.poll().B, { down: false, pressed: false, released: true });
  });

  test('a tap shorter than a tick still reads as a press, then a release', () => {
    const { input } = makeInput();
    input.poll();
    input.setRemoteState({ A: true });
    input.setRemoteState({ A: false }); // press and release arrived between two ticks
    const c = input.poll();
    assert.equal(c.A.pressed, true);
    assert.equal(input.poll().A.released, true);
    assert.equal(input.poll().A.down, false, 'latched only once');
  });

  test('sample() latches a held phone button; flush() drops latched taps', () => {
    const { input } = makeInput();
    input.setRemoteState({ Z: true });
    input.poll();
    input.sample();
    input.setRemoteState({});
    assert.equal(input.poll().Z.down, true, 'the sampled hold still counts');
    assert.equal(input.poll().Z.down, false);

    input.setRemoteState({ START: true });
    input.setRemoteState({});
    input.flush();
    assert.equal(input.poll().START.down, false, 'flushed tap is gone');
  });

  test('flush() makes a held phone button not a fresh press', () => {
    const { input } = makeInput();
    input.setRemoteState({ START: true });
    input.flush();
    const c = input.poll();
    assert.equal(c.START.down, true);
    assert.equal(c.START.pressed, false);
  });

  test('keys, pads, touch and phone buttons are OR-ed', () => {
    const { input, down } = makeInput([pad([0, 0, 0, 0], [0])]);
    input.setTouchState({ B: true });
    input.setRemoteState({ Z: true, CU: true });
    down('KeyC');
    const c = input.poll();
    for (const b of ['A', 'B', 'Z', 'CU', 'R']) assert.equal(c[b].down, true, b);
    assert.equal(c.START.down, false);
  });

  test('the phone stick wins only when pushed at least as far as the others', () => {
    const { input, down, up } = makeInput();
    // Keys: full push after the ease-in (raw magnitude 1) beats a half-pushed phone stick.
    down('KeyW');
    input.setRemoteState({ stickX: 0.5, stickY: 0 });
    let c = input.poll();
    assert.equal(c.stickX, 0);
    assert.ok(c.stickY > 0, 'keys win');
    // A phone stick at full tilt beats the keys.
    input.setRemoteState({ stickX: 1, stickY: 0 });
    c = input.poll();
    assert.equal(c.stickX, 1);
    assert.equal(c.stickY, 0);
    up('KeyW');

    // Touch vs phone: the one pushed further drives.
    input.setTouchState({ stickX: 0, stickY: 0.9 });
    input.setRemoteState({ stickX: 0.3, stickY: 0 });
    c = input.poll();
    assert.equal(c.stickY, 0.9);
    input.setRemoteState({ stickX: -0.95, stickY: 0 });
    c = input.poll();
    assert.equal(c.stickX, -0.95);
    input.setTouchState(null);

    // Gamepad stick (dead-zoned) vs phone.
    const { input: i2 } = makeInput([pad([0, -1, 0, 0])]);
    i2.setRemoteState({ stickX: 0.4, stickY: 0 });
    c = i2.poll();
    assert.equal(c.stickY, 1, 'the pad at full tilt wins');
    i2.setRemoteState(null);
    assert.equal(i2.poll().stickY, 1, 'a released phone leaves the pad alone');
  });

  test('a disabled input ignores the phone', () => {
    const { input } = makeInput();
    input.enabled = false;
    input.setRemoteState({ A: true, stickX: 1 });
    const c = input.poll();
    assert.equal(c.A.down, false);
    assert.equal(c.stickMag, 0);
  });

  test('touch and phone are separate channels', () => {
    const { input } = makeInput();
    input.setTouchState({ A: true });
    input.setRemoteState(null); // the phone leaving must not release the touch button
    assert.equal(input.poll().A.down, true);
    input.setRemoteState({ A: true });
    input.setTouchState(null);
    assert.equal(input.poll().A.down, true, 'and the other way round');
    assert.equal(input.touch.A, false);
    assert.equal(input.remote.A, true);
  });
});
