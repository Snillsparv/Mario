import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeInput, decodeInput, makeRoomCode, isRoomCode, PAD_BUTTONS } from '../src/net/protocol.js';

test('input round-trips through the compact message', () => {
  const state = { stickX: 0.5, stickY: -0.25, A: true, Z: true, CL: true };
  const back = decodeInput(JSON.parse(JSON.stringify(encodeInput(state))));
  assert.equal(back.stickX, 0.5);
  assert.equal(back.stickY, -0.25);
  for (const b of PAD_BUTTONS) assert.equal(back[b], !!state[b], b);
});

test('decode rejects malformed messages and clamps the stick', () => {
  assert.equal(decodeInput({ t: 'input', s: [NaN, 0, 0] }), null);
  assert.equal(decodeInput({ t: 'input', s: [0, 0] }), null);
  assert.equal(decodeInput({ t: 'rumble' }), null);
  const s = decodeInput({ t: 'input', s: [3, 4, 0] });
  assert.ok(Math.abs(Math.hypot(s.stickX, s.stickY) - 1) < 1e-9);
});

test('room codes are four unambiguous capitals', () => {
  for (let i = 0; i < 50; i++) {
    const c = makeRoomCode();
    assert.ok(isRoomCode(c), c);
    assert.ok(!/[IOL]/.test(c), c);
  }
  assert.equal(isRoomCode('ab12'), false);
});
