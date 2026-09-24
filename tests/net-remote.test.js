// net/RemotePad.js: the game's side of the phone controller, driven with a fake fetch, fake
// WebSockets and fake timers (no network, no DOM).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  RemotePad,
  shouldProbe,
  isLocalHost,
  parsePadInfo,
  withRoom,
  reconnectDelay,
  gameSocketUrl,
  INPUT_STALE_MS,
  HURT_RUMBLE_MS,
  CLOSE_REPLACED,
  RETRY_MAX_MS,
  GAME_NAME,
} from '../src/net/RemotePad.js';
import { isRoomCode, encodeInput, PAD_INFO_PATH } from '../src/net/protocol.js';
import { Events } from '../src/core/events.js';

// ---- fakes -------------------------------------------------------------------------------------

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { at: now + Math.max(0, ms || 0), fn });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    // Run every timer due within `ms`, in time order.
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let best = null;
        for (const [id, t] of pending) if (t.at <= end && (!best || t.at < best[1].at)) best = [id, t];
        if (!best) break;
        pending.delete(best[0]);
        now = best[1].at;
        best[1].fn();
      }
      now = end;
    },
    get count() {
      return pending.size;
    },
  };
}

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = null;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close(code, reason) {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  // server side
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg) {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onerror?.({});
    this.onclose?.({ code });
  }
}

const LOC = { protocol: 'http:', host: '192.168.1.20:5173', hostname: '192.168.1.20', port: '5173', search: '' };
const INFO = { urls: ['http://192.168.1.20:5173/pad.html', 'http://localhost:5173/pad.html'] };

function okJson(body) {
  return { ok: true, status: 200, json: async () => body };
}

function setup({ fetchImpl, location = LOC, storage = null } = {}) {
  const timers = fakeTimers();
  const events = new Events();
  const states = [];
  const input = { setRemoteState: (s) => states.push(s && { ...s }) };
  const sockets = [];
  const fetchCalls = [];
  const fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    return (fetchImpl ?? (async () => okJson(INFO)))(url, opts);
  };
  let seed = 0.1;
  const rng = () => (seed = (seed * 9301 + 0.49297) % 1);
  const pad = new RemotePad({
    input,
    events,
    fetch,
    location,
    timers,
    rng,
    storage,
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
  });
  const log = [];
  for (const name of ['phonePad', 'remotePress', 'remoteRelease']) events.on(name, (e) => log.push([name, e]));
  return { pad, timers, events, input, states, sockets, fetchCalls, log, last: () => sockets[sockets.length - 1] };
}

// Joined relay link with a phone in the room.
async function linked(opts) {
  const t = setup(opts);
  assert.equal(await t.pad.start(), true);
  t.last().open();
  t.last().receive({ t: 'peer', connected: true });
  return t;
}

// Console must stay silent: count any output while a test runs.
let consoleCalls;
const originals = {};
beforeEach(() => {
  consoleCalls = [];
  for (const k of ['error', 'warn', 'log', 'info', 'debug']) {
    originals[k] = console[k];
    console[k] = (...a) => consoleCalls.push([k, ...a]);
  }
});
afterEach(() => {
  for (const k of Object.keys(originals)) console[k] = originals[k];
});

// ---- helpers -----------------------------------------------------------------------------------

describe('probe rules and helpers', () => {
  test('local servers are probed, public https hosts are not', () => {
    assert.equal(shouldProbe({ protocol: 'http:', hostname: 'localhost', port: '5173' }), true);
    assert.equal(shouldProbe({ protocol: 'http:', hostname: 'example.com', port: '' }), true, 'plain http: a dev server');
    assert.equal(shouldProbe({ protocol: 'https:', hostname: 'someone.github.io', port: '' }), false);
    assert.equal(shouldProbe({ protocol: 'https:', hostname: '192.168.0.4', port: '' }), true);
    assert.equal(shouldProbe({ protocol: 'https:', hostname: 'devbox', port: '' }), true);
    assert.equal(shouldProbe({ protocol: 'https:', hostname: 'example.com', port: '4173' }), true);
    assert.equal(shouldProbe({ protocol: 'file:', hostname: '', port: '' }), false);
    assert.equal(shouldProbe({ protocol: 'https:', hostname: 'x.io', port: '', search: '?pad=1' }), true, '?pad=1 forces it');
    assert.equal(shouldProbe({ protocol: 'http:', hostname: 'localhost', port: '5173', search: '?pad=0' }), false, '?pad=0 turns it off');
    assert.equal(shouldProbe(null), false);
  });

  test('local host names', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.0.8', '172.20.1.1', '192.168.1.20', 'pc.local', 'mypc', '[::1]', 'fd12:3456::1']) {
      assert.equal(isLocalHost(h), true, h);
    }
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1', 'user.github.io', '']) assert.equal(isLocalHost(h), false, h);
  });

  test('pad info parsing keeps http(s) URLs only', () => {
    assert.deepEqual(parsePadInfo(INFO), INFO.urls);
    assert.deepEqual(parsePadInfo({ urls: ['javascript:alert(1)', 42, 'http://10.0.0.2:5173/pad.html', 'nope'] }), ['http://10.0.0.2:5173/pad.html']);
    assert.deepEqual(parsePadInfo('<html>'), []);
    assert.deepEqual(parsePadInfo(null), []);
    assert.deepEqual(parsePadInfo({ urls: 'x' }), []);
  });

  test('room parameter, socket URL and retry delays', () => {
    assert.equal(withRoom('http://192.168.1.20:5173/pad.html', 'ABCD'), 'http://192.168.1.20:5173/pad.html?room=ABCD');
    assert.equal(withRoom('http://h/pad.html?room=ZZZZ', 'ABCD'), 'http://h/pad.html?room=ABCD');
    assert.equal(gameSocketUrl(LOC), 'ws://192.168.1.20:5173/pad-ws');
    assert.equal(gameSocketUrl({ protocol: 'https:', host: 'box:8443' }), 'wss://box:8443/pad-ws');
    const mid = () => 0.5;
    assert.equal(reconnectDelay(1, mid), 1000);
    assert.equal(reconnectDelay(2, mid), 2000);
    assert.equal(reconnectDelay(20, mid), RETRY_MAX_MS);
    assert.ok(reconnectDelay(1, () => 0) >= 850 && reconnectDelay(1, () => 0.999) <= 1150);
  });
});

// ---- unavailable ---------------------------------------------------------------------------------

describe('no relay: unavailable and silent', () => {
  const cases = {
    'network error': async () => {
      throw new TypeError('Failed to fetch');
    },
    '404': async () => ({ ok: false, status: 404, json: async () => ({}) }),
    'HTML fallback page': async () => ({ ok: true, status: 200, json: async () => JSON.parse('<!doctype html>') }),
    'JSON without urls': async () => okJson({ hello: 1 }),
    'empty url list': async () => okJson({ urls: [] }),
  };
  for (const [name, fetchImpl] of Object.entries(cases)) {
    test(name, async () => {
      const t = setup({ fetchImpl });
      assert.equal(await t.pad.start(), false);
      assert.equal(t.pad.available, false);
      assert.equal(t.pad.padUrl, null);
      assert.equal(t.pad.status, 'unavailable');
      assert.equal(t.sockets.length, 0, 'no socket');
      assert.deepEqual(t.log, [], 'no events');
      assert.equal(t.fetchCalls[0].url, PAD_INFO_PATH);
      assert.deepEqual(consoleCalls, [], 'nothing logged');
    });
  }

  test('a probe that never answers times out', async () => {
    let aborted = false;
    const t = setup({
      fetchImpl: (url, opts) =>
        new Promise((resolve, reject) => {
          opts?.signal?.addEventListener?.('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    });
    const done = t.pad.start();
    await Promise.resolve();
    t.timers.advance(5000);
    assert.equal(await done, false);
    assert.equal(aborted, true, 'the request is aborted');
    assert.equal(t.sockets.length, 0);
    assert.deepEqual(consoleCalls, []);
  });

  test('a public static host is not even asked', async () => {
    const t = setup({ location: { protocol: 'https:', host: 'someone.github.io', hostname: 'someone.github.io', port: '', search: '' } });
    assert.equal(await t.pad.start(), false);
    assert.equal(t.fetchCalls.length, 0);
    assert.equal(t.pad.available, false);
  });

  test('start() probes once', async () => {
    const t = setup();
    const a = t.pad.start();
    const b = t.pad.start();
    assert.equal(a, b);
    await a;
    assert.equal(t.fetchCalls.length, 1);
    assert.equal(t.sockets.length, 1);
  });
});

// ---- available -----------------------------------------------------------------------------------

describe('with a relay', () => {
  test('joins its room as the game and publishes the pad URL', async () => {
    const t = setup();
    assert.equal(await t.pad.start(), true);
    assert.equal(t.pad.available, true);
    assert.ok(isRoomCode(t.pad.room), t.pad.room);
    assert.equal(t.pad.padUrl, `${INFO.urls[0]}?room=${t.pad.room}`);
    assert.deepEqual(t.pad.urls, INFO.urls);
    assert.equal(t.log[0][0], 'phonePad');
    assert.equal(t.log[0][1].available, true);
    assert.equal(t.log[0][1].connected, false);
    const ws = t.last();
    assert.equal(ws.url, 'ws://192.168.1.20:5173/pad-ws');
    assert.equal(t.pad.status, 'connecting');
    ws.open();
    assert.deepEqual(ws.sent, [{ t: 'join', role: 'game', room: t.pad.room }]);
    ws.receive({ t: 'peer', connected: false }); // the join ack: no phone yet
    assert.equal(t.pad.status, 'online');
    assert.equal(t.pad.connected, false);
    assert.deepEqual(consoleCalls, []);
  });

  test('a phone joining: connected, hello, phonePad event', async () => {
    const t = setup();
    await t.pad.start();
    const ws = t.last();
    ws.open();
    ws.receive({ t: 'peer', connected: false });
    t.log.length = 0;
    ws.receive({ t: 'peer', connected: true });
    assert.equal(t.pad.connected, true);
    assert.deepEqual(ws.sent.at(-1), { t: 'hello', name: GAME_NAME });
    assert.deepEqual(t.log, [['phonePad', { connected: true, available: true, room: t.pad.room, padUrl: t.pad.padUrl }]]);
  });

  test('input messages drive input.setRemoteState; junk is ignored', async () => {
    const t = await linked();
    const ws = t.last();
    t.states.length = 0;
    ws.receive(encodeInput({ stickX: 0.5, stickY: -0.25, A: true }));
    assert.equal(t.states.length, 1);
    assert.equal(t.states[0].stickX, 0.5);
    assert.equal(t.states[0].stickY, -0.25);
    assert.equal(t.states[0].A, true);
    assert.equal(t.states[0].B, false);
    ws.receive({ t: 'input', s: [NaN, 0, 0] });
    ws.receive({ t: 'input', s: 'x' });
    ws.receive('not json');
    ws.receive({ t: 'rumble', ms: 5 });
    assert.equal(t.states.length, 1, 'malformed messages change nothing');
    assert.deepEqual(consoleCalls, []);
  });

  test('button edges are reported as remotePress / remoteRelease', async () => {
    const t = await linked();
    const ws = t.last();
    t.log.length = 0;
    ws.receive(encodeInput({ START: true }));
    ws.receive(encodeInput({ START: true, stickX: 0.3 })); // held: no new press
    ws.receive(encodeInput({ A: true }));
    assert.deepEqual(t.log, [
      ['remotePress', { button: 'START' }],
      ['remotePress', { button: 'A' }], // (edges of one message come in PAD_BUTTONS order)
      ['remoteRelease', { button: 'START' }],
    ]);
  });

  test('the phone leaving releases its controls', async () => {
    const t = await linked();
    const ws = t.last();
    ws.receive(encodeInput({ stickX: 0, stickY: 1, B: true }));
    t.log.length = 0;
    ws.receive({ t: 'peer', connected: false });
    assert.equal(t.pad.connected, false);
    assert.equal(t.states.at(-1), null, 'setRemoteState(null)');
    assert.deepEqual(t.log, [
      ['remoteRelease', { button: 'B' }],
      ['phonePad', { connected: false, available: true, room: t.pad.room, padUrl: t.pad.padUrl }],
    ]);
  });

  test('a phone that goes silent is released after INPUT_STALE_MS', async () => {
    const t = await linked();
    const ws = t.last();
    ws.receive(encodeInput({ stickY: 1 }));
    t.timers.advance(INPUT_STALE_MS - 100);
    ws.receive(encodeInput({ stickY: 1 })); // the phone's 100 ms heartbeat keeps it alive
    t.timers.advance(INPUT_STALE_MS - 100);
    assert.notEqual(t.states.at(-1), null);
    t.timers.advance(200);
    assert.equal(t.states.at(-1), null, 'stick released');
    assert.equal(t.pad.connected, true, 'still in the room');
  });

  test('Pip getting hurt makes the phone rumble', async () => {
    const t = await linked();
    const ws = t.last();
    t.events.emit('hurt', { pos: { x: 0, y: 0, z: 0 }, amount: 1 });
    assert.deepEqual(ws.sent.at(-1), { t: 'rumble', ms: HURT_RUMBLE_MS });
  });

  test('no rumble without a phone', async () => {
    const t = setup();
    await t.pad.start();
    const ws = t.last();
    ws.open();
    ws.receive({ t: 'peer', connected: false });
    const n = ws.sent.length;
    t.events.emit('hurt', { amount: 1 });
    assert.equal(ws.sent.length, n);
  });

  test('a dropped link reconnects with backoff to the same room', async () => {
    const t = await linked();
    const room = t.pad.room;
    t.last().receive(encodeInput({ stickX: 1 }));
    t.log.length = 0;
    t.last().drop();
    assert.equal(t.pad.connected, false);
    assert.equal(t.states.at(-1), null, 'released when the link drops');
    assert.deepEqual(t.log.map((e) => e[0]), ['phonePad']);
    assert.equal(t.pad.status, 'offline');
    assert.equal(t.sockets.length, 1);
    t.timers.advance(1200);
    assert.equal(t.sockets.length, 2, 'retried after ~1 s');
    // Fails again: the delay grows.
    t.last().drop();
    t.timers.advance(1200);
    assert.equal(t.sockets.length, 2, 'second retry waits longer');
    t.timers.advance(1200);
    assert.equal(t.sockets.length, 3);
    t.last().open();
    assert.deepEqual(t.last().sent[0], { t: 'join', role: 'game', room });
    t.last().receive({ t: 'peer', connected: true });
    assert.equal(t.pad.failures, 0, 'a join resets the backoff');
    assert.equal(t.pad.connected, true);
    assert.deepEqual(consoleCalls, []);
  });

  test('replaced by another game with the same code: a new room', async () => {
    const t = await linked();
    const room = t.pad.room;
    t.log.length = 0;
    t.last().drop(CLOSE_REPLACED);
    assert.notEqual(t.pad.room, room);
    assert.ok(isRoomCode(t.pad.room));
    assert.ok(t.log.some(([n, e]) => n === 'phonePad' && e.room === t.pad.room && e.padUrl.endsWith(`?room=${t.pad.room}`)));
    t.timers.advance(1200);
    t.last().open();
    assert.deepEqual(t.last().sent[0], { t: 'join', role: 'game', room: t.pad.room });
  });

  test('the room code survives a reload (sessionStorage)', async () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
    const a = setup({ storage });
    await a.pad.start();
    const b = setup({ storage });
    await b.pad.start();
    assert.equal(b.pad.room, a.pad.room);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const c = setup({ storage: broken });
    await c.pad.start();
    assert.ok(isRoomCode(c.pad.room), 'blocked storage still gives a code');
  });

  test('dispose() closes the link, releases the phone and stops retrying', async () => {
    const t = await linked();
    const ws = t.last();
    ws.receive(encodeInput({ A: true }));
    t.pad.dispose();
    assert.equal(ws.closed.code, 1000);
    assert.equal(t.pad.connected, false);
    assert.equal(t.states.at(-1), null);
    t.timers.advance(60000);
    assert.equal(t.sockets.length, 1, 'no reconnect');
    const n = ws.sent.length;
    t.events.emit('hurt', { amount: 1 });
    assert.equal(ws.sent.length, n, 'unsubscribed from hurt');
  });

  test('a socket that cannot even be created retries later', async () => {
    const t = setup();
    let fail = true;
    t.pad.createSocket = (url) => {
      if (fail) throw new Error('blocked');
      const s = new FakeSocket(url);
      t.sockets.push(s);
      return s;
    };
    await t.pad.start();
    assert.equal(t.pad.status, 'offline');
    fail = false;
    t.timers.advance(1200);
    assert.equal(t.sockets.length, 1);
    assert.deepEqual(consoleCalls, []);
  });
});
