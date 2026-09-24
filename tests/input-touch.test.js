// core/input: the touch controller's state (setTouchState) is merged into the virtual
// controller like one more gamepad (docs/ARCHITECTURE.md "Winged hat, minions, locked castle,
// touch controller").
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

describe('touch state merge', () => {
  test('the touch stick drives the controller with its exact value', () => {
    const { input } = makeInput();
    input.setTouchState({ stickX: 0.3, stickY: 0.4 });
    const c = input.poll();
    assert.equal(c.stickX, 0.3);
    assert.equal(c.stickY, 0.4);
    assert.ok(Math.abs(c.stickMag - 0.5) < 1e-12);
    assert.ok(Math.abs(c.rawStickMag - 0.5) < 1e-12, 'no keyboard ease-in for the touch stick');
    input.setTouchState({ stickX: 0, stickY: 0 });
    assert.equal(input.poll().stickMag, 0, 'released: neutral');
  });

  test('out-of-range and missing values are clamped / ignored', () => {
    const { input } = makeInput();
    input.setTouchState({ stickX: 5, stickY: NaN, A: 1 });
    const c = input.poll();
    assert.equal(c.stickX, 1);
    assert.equal(c.stickY, 0);
    assert.equal(c.A.down, true);
    input.setTouchState(null);
    const n = input.poll();
    assert.equal(n.stickMag, 0);
    assert.equal(n.A.down, false);
    assert.equal(n.A.released, true);
  });

  test('touch buttons give pressed / held / released edges like keys', () => {
    const { input } = makeInput();
    input.setTouchState({ A: true });
    assert.deepEqual(input.poll().A, { down: true, pressed: true, released: false });
    assert.deepEqual(input.poll().A, { down: true, pressed: false, released: false });
    input.setTouchState({});
    assert.deepEqual(input.poll().A, { down: false, pressed: false, released: true });
  });

  test('a tap shorter than a tick still reads as a press, then a release', () => {
    const { input } = makeInput();
    input.poll();
    input.setTouchState({ B: true });
    input.setTouchState({ B: false }); // down and up between two polls
    const c = input.poll();
    assert.equal(c.B.pressed, true);
    assert.equal(input.poll().B.released, true);
    assert.equal(input.poll().B.down, false, 'latched only once');
  });

  test('sample() latches a held touch button too', () => {
    const { input } = makeInput();
    input.setTouchState({ Z: true });
    input.poll();
    input.sample();
    input.setTouchState({}); // released before the next poll: the sampled hold still counts
    assert.equal(input.poll().Z.down, true);
    assert.equal(input.poll().Z.down, false);
  });

  test('keys and touch buttons are OR-ed; the stick pushed furthest wins', () => {
    const { input, down } = makeInput();
    down('KeyJ'); // B on the keyboard
    input.setTouchState({ A: true, stickX: 0.2, stickY: 0 });
    const c = input.poll();
    assert.equal(c.A.down, true);
    assert.equal(c.B.down, true);
    assert.equal(c.stickX, 0.2);
    // A full keyboard push (after its ease-in) beats a small touch push...
    down('KeyW');
    let k;
    for (let i = 0; i < 10; i++) k = input.poll();
    assert.equal(k.stickY, 1);
    assert.equal(k.stickX, 0);
    // ...and a pad stick pushed further than the touch stick wins over it too.
    const p = makeInput([pad([0, -1, 0, 0])]);
    p.input.setTouchState({ stickX: 0.5, stickY: 0 });
    const q = p.input.poll();
    assert.equal(q.stickY, 1);
    assert.equal(q.stickX, 0);
    // A touch stick pushed further than a pad's small tilt wins.
    const r = makeInput([pad([0.3, 0, 0, 0])]);
    r.input.setTouchState({ stickX: 0, stickY: -0.9 });
    const s = r.input.poll();
    assert.equal(s.stickY, -0.9);
    assert.equal(s.stickX, 0);
  });

  test('flush() drops latched touch taps; a held touch button is not a fresh press', () => {
    const { input } = makeInput();
    input.setTouchState({ START: true });
    input.setTouchState({ START: false }); // a tap on the title
    input.flush();
    assert.equal(input.poll().START.pressed, false, 'the title tap never reaches the game');
    input.setTouchState({ A: true }); // held through the title
    input.flush();
    const c = input.poll();
    assert.equal(c.A.down, true);
    assert.equal(c.A.pressed, false);
  });

  test('a disabled input ignores the touch controller', () => {
    const { input } = makeInput();
    input.enabled = false;
    input.setTouchState({ A: true, stickX: 1 });
    const c = input.poll();
    assert.equal(c.A.down, false);
    assert.equal(c.stickMag, 0);
    input.addLookDelta(10, 5);
    assert.equal(input.poll().mouseDX, 0);
  });

  test('test overrides still win over the touch state', () => {
    const { input } = makeInput();
    input.setTouchState({ stickX: 1, stickY: 0 });
    input.setOverride({ stickX: 0, stickY: -1, B: true });
    const c = input.poll();
    assert.equal(c.stickX, 0);
    assert.equal(c.stickY, -1);
    assert.equal(c.B.down, true);
  });

  test('picture drags add to the mouse-drag camera orbit', () => {
    const { input } = makeInput();
    input.addLookDelta(12, -4);
    input.addLookDelta(3, 1);
    const c = input.poll();
    assert.equal(c.mouseDX, 15);
    assert.equal(c.mouseDY, -3);
    assert.equal(input.poll().mouseDX, 0, 'consumed by the poll');
  });

  test('setTouchState copies: the caller may reuse and change its object', () => {
    const { input } = makeInput();
    const st = { stickX: 0.5, stickY: 0, A: true };
    input.setTouchState(st);
    st.stickX = 0;
    st.A = false;
    const c = input.poll();
    assert.equal(c.stickX, 0.5);
    assert.equal(c.A.down, true);
  });
});
