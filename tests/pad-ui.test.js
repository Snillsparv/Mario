// The pad page's small parts: the game code from the URL and the code keys
// (src/pad/codeEntry.js), the status texts (src/pad/statusStrip.js) and the guarded phone
// features (src/pad/device.js: vibration, wake lock, fullscreen) with stand-in browser objects.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { roomFromSearch, editCode, ROOM_LETTERS, CODE_LENGTH } from '../src/pad/codeEntry.js';
import { statusView } from '../src/pad/statusStrip.js';
import { vibrate, keepAwake, canFullscreen, isFullscreen, toggleFullscreen } from '../src/pad/device.js';
import { makeRoomCode, isRoomCode } from '../src/net/protocol.js';

describe('game code', () => {
  test('read from ?room=, any case, only when valid', () => {
    assert.equal(roomFromSearch('?room=ABCD'), 'ABCD');
    assert.equal(roomFromSearch('?room=wxyz&x=1'), 'WXYZ');
    assert.equal(roomFromSearch('?room=%20kmpq%20'), 'KMPQ');
    for (const bad of ['', '?', '?room=', '?room=ABC', '?room=ABCDE', '?room=AB1D', '?room=ÄBCD', '?code=ABCD']) assert.equal(roomFromSearch(bad), null, bad);
  });

  test('the keys offer exactly the letters a game code can have', () => {
    assert.equal(ROOM_LETTERS.length, 23);
    assert.ok(!/[IOL]/.test(ROOM_LETTERS));
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const seen = new Set();
    for (let i = 0; i < 2000; i++) for (const ch of makeRoomCode(rng)) seen.add(ch);
    assert.deepEqual([...seen].sort().join(''), ROOM_LETTERS, 'makeRoomCode uses the same letters');
  });

  test('typing: letters up to four, delete, clear; look-alikes and junk ignored', () => {
    let c = '';
    for (const k of ['k', 'M', 'I', 'O', 'l', '1', ' ', 'Enter', 'p']) c = editCode(c, k);
    assert.equal(c, 'KMP');
    c = editCode(c, 'z');
    assert.equal(c, 'KMPZ');
    assert.ok(isRoomCode(c));
    assert.equal(editCode(c, 'A'), 'KMPZ', 'full');
    assert.equal(c.length, CODE_LENGTH);
    assert.equal(editCode(c, 'Backspace'), 'KMP');
    assert.equal(editCode('', 'Backspace'), '');
    assert.equal(editCode(c, 'Clear'), '');
    assert.equal(editCode('AB', undefined), 'AB');
  });
});

test('status texts', () => {
  assert.deepEqual(statusView('connecting', { room: 'ABCD' }), { text: 'Connecting...', tone: 'busy' });
  assert.deepEqual(statusView('connected', { room: 'ABCD' }), { text: 'Connected to game ABCD', tone: 'ok' });
  assert.match(statusView('waiting', { room: 'ABCD' }).text, /^Game ABCD not found, waiting/);
  assert.equal(statusView('reconnecting', { failures: 1 }).text, 'Reconnecting...');
  assert.match(statusView('reconnecting', { failures: 3 }).text, /^Reconnecting\.\.\. is the game running\?/);
  assert.equal(statusView('replaced', { room: 'ABCD' }).action, 'retry');
  for (const s of ['idle', 'connecting', 'waiting', 'connected', 'reconnecting', 'replaced', 'stopped']) {
    const v = statusView(s, { room: 'ABCD', failures: 5 });
    assert.ok(v.text.length > 0 && v.text.length <= 40, `${s}: short enough for a phone's strip`);
    assert.ok(['ok', 'wait', 'busy', 'off'].includes(v.tone));
  }
});

describe('phone features (guarded)', () => {
  test('vibrate: only where there is an API and a prior tap; never throws', () => {
    const calls = [];
    const nav = { vibrate: (ms) => calls.push(ms) !== 0, userActivation: { hasBeenActive: true } };
    assert.equal(vibrate(120.4, nav), true);
    assert.deepEqual(calls, [120]);
    assert.equal(vibrate(50, { ...nav, userActivation: { hasBeenActive: false } }), false, 'before the first tap');
    assert.equal(vibrate(50, {}), false, 'no API (iPhone)');
    assert.equal(vibrate(50, undefined), false);
    assert.equal(vibrate(50, { vibrate: () => { throw new Error('denied'); } }), false);
    assert.equal(vibrate(50, { vibrate: () => false }), false);
  });

  test('wake lock: held while visible, asked for again when the page shows or on a tap', async () => {
    const listeners = {};
    const doc = {
      visibilityState: 'visible',
      addEventListener: (type, fn) => ((listeners[type] ??= new Set()).add(fn)),
      removeEventListener: (type, fn) => listeners[type]?.delete(fn),
    };
    const fire = (type) => [...(listeners[type] ?? [])].forEach((fn) => fn());
    let requests = 0;
    let refuse = true;
    const sentinels = [];
    const nav = {
      wakeLock: {
        request: async (kind) => {
          assert.equal(kind, 'screen');
          requests++;
          if (refuse) throw new Error('NotAllowedError');
          const handlers = [];
          const s = {
            released: false,
            addEventListener: (t, fn) => t === 'release' && handlers.push(fn),
            release: async () => {
              s.released = true;
              handlers.forEach((fn) => fn());
            },
          };
          sentinels.push(s);
          return s;
        },
      },
    };
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const awake = keepAwake({ nav, doc });
    await tick();
    assert.equal(requests, 1);
    assert.equal(awake.held(), false, 'refused without a gesture');
    refuse = false;
    fire('click'); // a tap: asked again
    await tick();
    assert.equal(awake.held(), true);
    fire('touchend'); // already held: no new request
    await tick();
    assert.equal(requests, 2);
    // Hidden: the browser drops the lock; shown again: re-requested.
    doc.visibilityState = 'hidden';
    await sentinels[0].release();
    fire('visibilitychange');
    await tick();
    assert.equal(awake.held(), false);
    assert.equal(requests, 2, 'not while hidden');
    doc.visibilityState = 'visible';
    fire('visibilitychange');
    await tick();
    assert.equal(awake.held(), true);
    assert.equal(requests, 3);
    awake.release();
    assert.equal(sentinels[1].released, true);
    assert.equal(listeners.visibilitychange.size, 0);
    // No API at all: nothing happens, nothing throws.
    const none = keepAwake({ nav: {}, doc });
    await tick();
    assert.equal(none.held(), false);
    none.release();
  });

  test('fullscreen: offered only where the page can go fullscreen; toggles', async () => {
    assert.equal(canFullscreen({ documentElement: {} }), false, 'iPhone Safari');
    const doc = {
      fullscreenEnabled: true,
      fullscreenElement: null,
      documentElement: {
        requestFullscreen: async (opts) => {
          assert.deepEqual(opts, { navigationUI: 'hide' });
          doc.fullscreenElement = doc.documentElement;
        },
      },
      exitFullscreen: async () => {
        doc.fullscreenElement = null;
      },
    };
    assert.equal(canFullscreen(doc), true);
    await toggleFullscreen(doc);
    assert.equal(isFullscreen(doc), true);
    await toggleFullscreen(doc);
    assert.equal(isFullscreen(doc), false);
    // Refused (no gesture): stays as it was, no throw.
    doc.documentElement.requestFullscreen = async () => {
      throw new Error('denied');
    };
    await toggleFullscreen(doc);
    assert.equal(isFullscreen(doc), false);
    // Prefixed (older Safari on iPad).
    const w = { webkitFullscreenEnabled: true, documentElement: { webkitRequestFullscreen: () => (w.webkitFullscreenElement = 1) }, webkitExitFullscreen: () => (w.webkitFullscreenElement = null) };
    assert.equal(canFullscreen(w), true);
    await toggleFullscreen(w);
    assert.equal(isFullscreen(w), true);
    await toggleFullscreen(w);
    assert.equal(isFullscreen(w), false);
  });
});
