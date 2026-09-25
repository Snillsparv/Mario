// The pad page's small parts: the game code from the URL and the code keys
// (src/pad/codeEntry.js), the status texts (src/pad/statusStrip.js) and the guarded phone
// features (src/pad/device.js: vibration, keeping the screen on, fullscreen) with stand-in
// browser objects.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { roomFromSearch, editCode, ROOM_LETTERS, CODE_LENGTH } from '../src/pad/codeEntry.js';
import { statusView } from '../src/pad/statusStrip.js';
import { vibrate, keepAwake, needsAudibleVideo, canFullscreen, isFullscreen, toggleFullscreen } from '../src/pad/device.js';
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
  assert.equal(statusView('waiting', { room: 'ABCD' }).text, 'Game ABCD not found yet');
  assert.equal(statusView('reconnecting', { failures: 1 }).text, 'Reconnecting...');
  assert.equal(statusView('reconnecting', { failures: 3 }).text, 'Reconnecting... game on?');
  const replaced = statusView('replaced', { room: 'ABCD' });
  assert.equal(replaced.action, 'retry');
  assert.match(replaced.text, /tap to rejoin$/, 'the way back is in the text, and at its end');
  for (const s of ['idle', 'connecting', 'waiting', 'connected', 'reconnecting', 'replaced', 'stopped']) {
    // The strip of a 320 px phone has room for about 26 characters (the widest code: WMWM);
    // tests/pad-browser.test.js measures the real thing.
    const v = statusView(s, { room: 'WMWM', failures: 5 });
    assert.ok(v.text.length > 0 && v.text.length <= 26, `${s}: "${v.text}" short enough for a phone's strip`);
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

  // A stand-in page for the video fallback: canvas streams, <video>, Web Audio, timers.
  function fakePage({ webkit = false, captureStream = true, gestureNeeded = webkit } = {}) {
    const listeners = {};
    const log = [];
    let gesture = false;
    const track = (kind) => ({ kind, stopped: false, stop() { this.stopped = true; } });
    const body = { children: [], appendChild: (el) => (body.children.push(el), (el.parentNode = body)) };
    const doc = {
      visibilityState: 'visible',
      body,
      addEventListener: (type, fn) => ((listeners[type] ??= new Set()).add(fn)),
      removeEventListener: (type, fn) => listeners[type]?.delete(fn),
      createElement(tag) {
        if (tag === 'canvas') {
          const c = { getContext: () => ({ fillRect: () => log.push('paint') }) };
          if (captureStream) c.captureStream = () => ({ getVideoTracks: () => [track('video')] });
          return c;
        }
        assert.equal(tag, 'video');
        const attrs = {};
        const v = {
          paused: true,
          muted: false,
          style: {},
          setAttribute: (k, val) => (attrs[k] = val),
          attrs,
          play() {
            v.paused = false;
            if (gestureNeeded && !v.muted && !gesture) {
              v.paused = true;
              return Promise.reject(new Error('NotAllowedError'));
            }
            return Promise.resolve();
          },
          pause: () => (v.paused = true),
          remove: () => body.children.splice(body.children.indexOf(v), 1),
        };
        return v;
      },
    };
    const contexts = [];
    class FakeAudioContext {
      constructor() {
        this.state = 'suspended';
        contexts.push(this);
      }
      resume() {
        if (gesture) this.state = 'running';
        return gesture ? Promise.resolve() : Promise.reject(new Error('NotAllowedError'));
      }
      suspend() {
        this.state = 'suspended';
        return Promise.resolve();
      }
      close() {
        this.state = 'closed';
        return Promise.resolve();
      }
      createGain() {
        return { gain: { value: 1 }, connect() {} };
      }
      createOscillator() {
        return { connect() {}, start() {} };
      }
    }
    FakeAudioContext.prototype.createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [track('audio')] } });
    const timers = new Set();
    const win = {
      MediaStream: class {
        constructor(tracks) {
          this.tracks = tracks;
        }
        getTracks() {
          return this.tracks;
        }
      },
      AudioContext: FakeAudioContext,
      HTMLVideoElement: { prototype: webkit ? { webkitSetPresentationMode() {} } : {} },
      setInterval: (fn) => (timers.add(fn), fn),
      clearInterval: (id) => timers.delete(id),
    };
    const nav = webkit ? { audioSession: { type: 'auto' } } : {};
    const fire = (type) => {
      gesture = ['touchend', 'pointerup', 'click'].includes(type);
      [...(listeners[type] ?? [])].forEach((fn) => fn());
      gesture = false;
    };
    return { doc, win, nav, fire, log, timers, contexts, listeners, video: () => body.children[0] };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test('keep awake without the wake lock API (http on the LAN), Chromium: a muted stream video, playing at once', async () => {
    const page = fakePage();
    assert.equal(needsAudibleVideo(page.win), false);
    const awake = keepAwake(page);
    assert.equal(awake.mode, 'video');
    const v = page.video();
    assert.ok(v, 'a video in the page');
    assert.equal(v.muted, true);
    assert.equal(v.playsInline, true);
    assert.equal(v.attrs.playsinline, '', 'not the full-screen player on phones');
    assert.match(v.style.cssText, /position:fixed/);
    assert.match(v.style.cssText, /width:2px;height:2px/);
    assert.match(v.style.cssText, /left:0;bottom:0/, 'inside the view (Chromium wants it on screen)');
    assert.match(v.style.cssText, /pointer-events:none/);
    assert.deepEqual(v.srcObject.getTracks().map((t) => t.kind), ['video']);
    assert.equal(page.contexts.length, 0, 'no audio');
    await settle();
    assert.equal(awake.held(), true, 'muted: no tap needed');
    assert.equal(page.timers.size, 1, 'the canvas is repainted now and then');
    // Hidden: paused (no screen to keep on); shown: playing again.
    page.doc.visibilityState = 'hidden';
    page.fire('visibilitychange');
    assert.equal(v.paused, true);
    assert.equal(awake.held(), false);
    assert.equal(page.timers.size, 0);
    page.fire('click');
    assert.equal(v.paused, true, 'not while hidden');
    page.doc.visibilityState = 'visible';
    page.fire('visibilitychange');
    await settle();
    assert.equal(awake.held(), true);
    // Released: gone, the stream stopped, no listeners left.
    const tracks = v.srcObject.getTracks();
    awake.release();
    assert.equal(page.video(), undefined);
    assert.ok(tracks.every((t) => t.stopped));
    assert.equal(page.timers.size, 0);
    assert.equal(page.listeners.visibilitychange.size, 0);
    assert.equal(page.listeners.touchend.size, 0);
    page.fire('click');
    assert.equal(page.video(), undefined, 'stays released');
  });

  test('keep awake, WebKit (iPhone): the video plays with a silent audio track, started by a tap', async () => {
    const page = fakePage({ webkit: true });
    assert.equal(needsAudibleVideo(page.win), true);
    const awake = keepAwake(page);
    await settle();
    const v = page.video();
    assert.equal(v.muted, false, 'WebKit keeps the screen on only for a video with sound');
    assert.deepEqual(v.srcObject.getTracks().map((t) => t.kind).sort(), ['audio', 'video']);
    assert.equal(page.contexts.length, 1);
    assert.equal(page.nav.audioSession.type, 'ambient', "the phone's music keeps playing");
    assert.equal(awake.held(), false, 'refused before a tap');
    page.fire('touchend');
    await settle();
    assert.equal(v.paused, false);
    assert.equal(page.contexts[0].state, 'running');
    assert.equal(awake.held(), true);
    page.fire('touchend'); // already playing: nothing new
    assert.equal(page.contexts.length, 1);
    page.doc.visibilityState = 'hidden';
    page.fire('visibilitychange');
    assert.equal(awake.held(), false);
    assert.equal(page.contexts[0].state, 'suspended');
    awake.release();
    assert.equal(page.contexts[0].state, 'closed');
  });

  test('keep awake: the wake lock API wins where the page has it; nothing at all where neither works', () => {
    const page = fakePage();
    const api = keepAwake({ ...page, nav: { wakeLock: { request: () => new Promise(() => {}) } } });
    assert.equal(api.mode, 'api');
    assert.equal(page.video(), undefined, 'no video when the API is there');
    api.release();
    const none = keepAwake(fakePage({ captureStream: false }));
    assert.equal(none.mode, null);
    assert.equal(none.held(), false);
    none.release();
    const noAudio = fakePage({ webkit: true });
    delete noAudio.win.AudioContext;
    assert.equal(keepAwake(noAudio).mode, null, 'WebKit without Web Audio: the video would not help');
    const oldWebAudio = fakePage({ webkit: true });
    delete oldWebAudio.win.AudioContext.prototype.createMediaStreamDestination;
    assert.equal(keepAwake(oldWebAudio).mode, null, 'no audio streams (iOS before 14.5)');
    // A piece that fails while it is built: no throw, no half-built video left behind.
    const broken = fakePage();
    const make = broken.doc.createElement;
    broken.doc.createElement = (tag) => (tag === 'video' ? null : make(tag));
    const b = keepAwake(broken);
    assert.equal(b.held(), false);
    broken.fire('click');
    assert.equal(broken.video(), undefined);
    b.release();
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
