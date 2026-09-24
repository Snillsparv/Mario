// The phone pad's link to the game (src/pad/padLink.js): join, what it sends and how often
// (buttons at once, the stick throttled, a heartbeat), statuses, rumble, reconnecting with
// backoff, and being replaced by another phone. A fake socket and a virtual clock stand in for
// the browser; the last test runs it against the real relay (tools/padRelay.js) over `ws`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import {
  PadLink,
  padSocketUrl,
  retryDelay,
  STICK_MIN_MS,
  HEARTBEAT_MS,
  CONNECT_TIMEOUT_MS,
  JOIN_ACK_MS,
  RETRY_FIRST_MS,
  RETRY_MAX_MS,
  RUMBLE_MAX_MS,
  CLOSE_REPLACED,
} from '../src/pad/padLink.js';
import { decodeInput, PAD_WS_PATH } from '../src/net/protocol.js';

// Virtual time: timers run in order as the clock advances.
class Clock {
  constructor() {
    this.t = 0;
    this.timers = new Map();
    this.next = 1;
    this.setTimeout = (fn, ms) => {
      const id = this.next++;
      this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
      return id;
    };
    this.clearTimeout = (id) => this.timers.delete(id);
    this.now = () => this.t;
  }
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      let first = null;
      for (const [id, tm] of this.timers) if (tm.at <= end && (!first || tm.at < first.tm.at)) first = { id, tm };
      if (!first) break;
      this.timers.delete(first.id);
      this.t = first.tm.at;
      first.tm.fn();
    }
    this.t = end;
  }
}

class FakeSocket {
  constructor(url, clock) {
    this.url = url;
    this.clock = clock;
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.out = []; // [time, message]
    this.closed = null;
  }
  send(data) {
    if (this.readyState !== 1) throw new Error('not open');
    this.out.push([this.clock.t, JSON.parse(data)]);
  }
  close(code) {
    this.closed = code ?? 1005;
    this.readyState = 3;
  }
  // The server side.
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg) {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  inputs() {
    return this.out.filter(([, m]) => m.t === 'input');
  }
}

function rig({ room = 'ABCD', rng = () => 0.5 } = {}) {
  const clock = new Clock();
  const sockets = [];
  const statuses = [];
  const rumbles = [];
  const link = new PadLink({
    url: 'ws://pc:5173/pad-ws',
    room,
    createSocket: (url) => {
      const s = new FakeSocket(url, clock);
      sockets.push(s);
      return s;
    },
    timers: clock,
    now: clock.now,
    rng,
    onStatus: (st) => statuses.push(st),
    onRumble: (ms) => rumbles.push(ms),
  });
  return { clock, sockets, statuses, rumbles, link, ws: () => sockets[sockets.length - 1] };
}

const state = (o = {}) => ({ stickX: 0, stickY: 0, A: false, B: false, Z: false, R: false, START: false, CU: false, CD: false, CL: false, CR: false, ...o });

describe('pad link', () => {
  test('joins its room, then sends the controller state; statuses follow the relay', () => {
    const { link, ws, statuses, clock } = rig();
    link.start();
    assert.equal(ws().url, 'ws://pc:5173/pad-ws');
    assert.equal(link.status, 'connecting');
    link.setState(state({ stickY: 0.5 })); // before the socket is open: kept for later
    assert.equal(ws().out.length, 0);
    ws().open();
    assert.deepEqual(ws().out[0][1], { t: 'join', role: 'pad', room: 'ABCD' });
    assert.deepEqual(ws().out[1][1], { t: 'input', s: [0, 0.5, 0] }, 'the current state right after the join');
    ws().receive({ t: 'peer', connected: false });
    assert.equal(link.status, 'waiting');
    ws().receive({ t: 'peer', connected: true });
    assert.equal(link.status, 'connected');
    ws().receive({ t: 'hello', name: 'Castle Grounds' });
    assert.equal(link.gameName, 'Castle Grounds');
    ws().receive({ t: 'peer', connected: false }); // the game tab closed
    assert.equal(link.status, 'waiting');
    assert.deepEqual(statuses, ['connecting', 'waiting', 'connected', 'connected', 'waiting']);
    clock.advance(10);
  });

  test('no answer to the join: waiting for the game', () => {
    const { link, ws, clock } = rig();
    link.start();
    ws().open();
    clock.advance(JOIN_ACK_MS - 1);
    assert.equal(link.status, 'connecting');
    clock.advance(1);
    assert.equal(link.status, 'waiting');
  });

  test('button changes go out at once, never merged: a 1 ms tap is a press and a release', () => {
    const { link, ws, clock } = rig();
    link.start();
    ws().open();
    ws().out.length = 0;
    clock.advance(5);
    link.setState(state({ A: true }));
    clock.advance(1);
    link.setState(state({ A: false }));
    link.setState(state({ A: false, B: true, CL: true }));
    const seen = ws().inputs().map(([, m]) => decodeInput(m));
    assert.deepEqual(seen.map((s) => [s.A, s.B, s.CL]), [
      [true, false, false],
      [false, false, false],
      [false, true, true],
    ]);
    // An unchanged state sends nothing.
    const n = ws().out.length;
    link.setState(state({ B: true, CL: true }));
    assert.equal(ws().out.length, n);
  });

  test('stick-only changes: at most one message per STICK_MIN_MS, the newest value last', () => {
    const { link, ws, clock } = rig();
    link.start();
    ws().open();
    clock.advance(200);
    ws().out.length = 0;
    // A thumb sweeping the stick at 120 Hz for one second.
    for (let i = 1; i <= 120; i++) {
      link.setState(state({ stickX: Math.sin(i / 10), stickY: 0.5 }));
      clock.advance(1000 / 120);
    }
    const sent = ws().inputs();
    assert.ok(sent.length <= Math.ceil(1000 / STICK_MIN_MS) + 1, `${sent.length} messages in a second`);
    assert.ok(sent.length >= 25, `still smooth: ${sent.length}`);
    for (let i = 1; i < sent.length; i++) assert.ok(sent[i][0] - sent[i - 1][0] >= STICK_MIN_MS - 1e-9, 'spaced out');
    // The final position arrives (trailing flush), within STICK_MIN_MS.
    link.setState(state({ stickX: -1, stickY: 0 }));
    link.setState(state({ stickX: -0.9, stickY: 0.1 }));
    clock.advance(STICK_MIN_MS);
    assert.deepEqual(ws().inputs().at(-1)[1].s, [-0.9, 0.1, 0]);
    // A button press during a stick burst goes out at once, with the newest stick.
    const before = ws().inputs().length;
    link.setState(state({ stickX: -0.8, stickY: 0.2 }));
    link.setState(state({ stickX: -0.8, stickY: 0.2, Z: true }));
    assert.equal(ws().inputs().length, before + 1);
    assert.deepEqual(ws().inputs().at(-1)[1].s, [-0.8, 0.2, 4]);
  });

  test('heartbeat: the state is resent at least every HEARTBEAT_MS while connected', () => {
    const { link, ws, clock } = rig();
    link.start();
    ws().open();
    link.setState(state({ stickY: 1, A: true }));
    clock.advance(1000);
    const sent = ws().inputs();
    assert.ok(sent.length >= 10, `${sent.length}`);
    for (let i = 1; i < sent.length; i++) assert.ok(sent[i][0] - sent[i - 1][0] <= HEARTBEAT_MS, 'no gap longer than the heartbeat');
    assert.deepEqual(sent.at(-1)[1].s, [0, 1, 1]);
  });

  test('a slow socket skips stick-only updates (the heartbeat brings the newest); buttons still go', () => {
    const { link, ws, clock } = rig();
    link.start();
    ws().open();
    clock.advance(100);
    ws().bufferedAmount = 100000;
    const n = ws().out.length;
    link.setState(state({ stickX: 0.3 }));
    clock.advance(STICK_MIN_MS * 2);
    assert.equal(ws().out.length, n, 'stick update held back');
    link.setState(state({ stickX: 0.3, B: true }));
    assert.equal(ws().out.length, n + 1, 'the button press still went');
    ws().bufferedAmount = 0;
    link.setState(state({ stickX: 0.6, B: true }));
    clock.advance(HEARTBEAT_MS);
    assert.deepEqual(ws().inputs().at(-1)[1].s, [0.6, 0, 2]);
  });

  test('rumble reaches the phone, clamped; junk from the server is ignored', () => {
    const { link, ws, rumbles } = rig();
    link.start();
    ws().open();
    ws().receive({ t: 'rumble', ms: 120 });
    ws().receive({ t: 'rumble', ms: 99999 });
    ws().receive({ t: 'rumble', ms: -5 });
    ws().receive({ t: 'rumble', ms: 'lots' });
    ws().receive('not json {');
    ws().receive('null');
    ws().receive({ t: 'what' });
    assert.deepEqual(rumbles, [120, RUMBLE_MAX_MS]);
    assert.equal(link.status, 'connecting');
  });

  test('reconnects with growing delays (capped), and quickly again after a good connection', () => {
    const { link, sockets, ws, clock, statuses } = rig({ rng: () => 0.5 }); // no jitter
    link.start();
    const delays = [];
    for (let i = 0; i < 6; i++) {
      const n = sockets.length;
      ws().drop(1006); // refused
      assert.equal(link.status, 'reconnecting');
      assert.equal(link.failures, i + 1);
      let t = 0;
      while (sockets.length === n) {
        clock.advance(50);
        t += 50;
      }
      delays.push(t);
    }
    assert.deepEqual(delays, [500, 1000, 2000, 4000, 5000, 5000]);
    assert.equal(statuses[0], 'connecting');
    assert.ok(statuses.slice(1).every((s) => s === 'reconnecting'));
    // Nothing is sent on a socket that is not open.
    assert.ok(sockets.every((s) => s.out.length === 0));
    // Connected, then lost: the first retry is quick again, and joins before sending.
    ws().open();
    assert.equal(link.failures, 0);
    ws().receive({ t: 'peer', connected: true });
    link.setState(state({ A: true }));
    ws().drop(1001);
    const n = sockets.length;
    clock.advance(RETRY_FIRST_MS * 0.85 - 1);
    assert.equal(sockets.length, n);
    clock.advance(RETRY_FIRST_MS * 0.3 + 2);
    assert.equal(sockets.length, n + 1);
    ws().open();
    assert.equal(ws().out[0][1].t, 'join');
    assert.deepEqual(ws().out[1][1].s, [0, 0, 1], 'the held button is sent again');
  });

  test('retry delays: doubling from RETRY_FIRST_MS to RETRY_MAX_MS with +-15% jitter', () => {
    assert.equal(retryDelay(1, () => 0.5), RETRY_FIRST_MS);
    assert.equal(retryDelay(3, () => 0.5), RETRY_FIRST_MS * 4);
    assert.equal(retryDelay(50, () => 0.5), RETRY_MAX_MS);
    assert.equal(retryDelay(1, () => 0), Math.round(RETRY_FIRST_MS * 0.85));
    assert.equal(retryDelay(99, () => 1), Math.round(RETRY_MAX_MS * 1.15));
  });

  test('a socket that never opens is given up after CONNECT_TIMEOUT_MS and retried', () => {
    const { link, sockets, clock } = rig();
    link.start();
    clock.advance(CONNECT_TIMEOUT_MS);
    assert.equal(sockets[0].closed, 1005, 'closed by the pad');
    assert.equal(link.status, 'reconnecting');
    clock.advance(RETRY_FIRST_MS * 1.2);
    assert.equal(sockets.length, 2);
    sockets[0].drop(); // its late close event changes nothing
    assert.equal(link.failures, 1);
  });

  test('replaced by another phone: no automatic retry; the player can take the game back', () => {
    const { link, sockets, ws, clock } = rig();
    link.start();
    ws().open();
    ws().drop(CLOSE_REPLACED);
    assert.equal(link.status, 'replaced');
    clock.advance(60000);
    link.wake(); // coming back into view does not fight for the seat either
    assert.equal(sockets.length, 1);
    link.retryNow();
    assert.equal(sockets.length, 2);
    assert.equal(link.status, 'connecting');
  });

  test('wake() retries at once while waiting to reconnect', () => {
    const { link, sockets, ws } = rig();
    link.start();
    ws().drop();
    assert.equal(sockets.length, 1);
    link.wake();
    assert.equal(sockets.length, 2);
    link.wake(); // already connecting: nothing more
    link.retryNow();
    assert.equal(sockets.length, 2);
  });

  test('stop() lets go of the game (neutral state), closes and stays closed', () => {
    const { link, sockets, ws, clock } = rig();
    link.start();
    ws().open();
    link.setState(state({ stickY: 1, A: true }));
    link.stop();
    assert.deepEqual(ws().inputs().at(-1)[1].s, [0, 0, 0], 'neutral before closing');
    assert.equal(ws().closed, 1000);
    assert.equal(link.status, 'stopped');
    ws().drop(1000);
    clock.advance(30000);
    link.wake();
    link.retryNow();
    assert.equal(sockets.length, 1);
    // A pending retry is cancelled by stop() too.
    const r = rig();
    r.link.start();
    r.ws().drop();
    r.link.stop();
    r.clock.advance(30000);
    assert.equal(r.sockets.length, 1);
  });

  test('socket URL follows the page: ws on http, wss on https', () => {
    assert.equal(padSocketUrl({ protocol: 'http:', host: '192.168.1.20:5173' }), `ws://192.168.1.20:5173${PAD_WS_PATH}`);
    assert.equal(padSocketUrl({ protocol: 'https:', host: 'pc.local' }), `wss://pc.local${PAD_WS_PATH}`);
  });
});

// ---- with the real relay (node's ws client in place of the browser's WebSocket) ----------

test('against the relay: the game sees the pad input, the pad gets rumble and hello', async (t) => {
  let attachPadRelay;
  try {
    ({ attachPadRelay } = await import('../tools/padRelay.js'));
  } catch {
    t.skip('tools/padRelay.js not available');
    return;
  }
  const server = http.createServer((req, res) => res.end());
  const relay = attachPadRelay(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `ws://127.0.0.1:${server.address().port}${PAD_WS_PATH}`;
  const until = async (fn, ms = 3000) => {
    const end = Date.now() + ms;
    while (!fn()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const game = new WebSocket(url);
  const got = [];
  game.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => game.on('open', r));
  game.send(JSON.stringify({ t: 'join', role: 'game', room: 'QRST' }));

  const statuses = [];
  const rumbles = [];
  const link = new PadLink({ url, room: 'QRST', createSocket: (u) => new WebSocket(u), onStatus: (s) => statuses.push(s), onRumble: (ms) => rumbles.push(ms) });
  try {
    link.start();
    await until(() => link.status === 'connected');
    await until(() => got.some((m) => m.t === 'peer' && m.connected));
    link.setState(state({ stickX: 0.25, stickY: -0.9, A: true }));
    await until(() => got.some((m) => m.t === 'input' && decodeInput(m)?.A));
    const seen = decodeInput(got.filter((m) => m.t === 'input').at(-1));
    assert.equal(seen.stickX, 0.25);
    assert.equal(seen.stickY, -0.9);
    link.setState(state({ stickX: 0.25, stickY: -0.9 }));
    await until(() => got.filter((m) => m.t === 'input').some((m, i, a) => i > 0 && decodeInput(a[i - 1]).A && !decodeInput(m).A));
    game.send(JSON.stringify({ t: 'hello', name: 'Castle Grounds' }));
    game.send(JSON.stringify({ t: 'rumble', ms: 180 }));
    await until(() => rumbles.length === 1 && link.gameName === 'Castle Grounds');
    assert.deepEqual(rumbles, [180]);
    // Heartbeat: the game keeps hearing from the pad while nothing changes.
    const n = got.length;
    await new Promise((r) => setTimeout(r, 350));
    assert.ok(got.length - n >= 2, `heartbeats: ${got.length - n}`);
    // The game leaves: waiting; it comes back: connected.
    game.close();
    await until(() => link.status === 'waiting');
    const game2 = new WebSocket(url);
    await new Promise((r) => game2.on('open', r));
    game2.send(JSON.stringify({ t: 'join', role: 'game', room: 'QRST' }));
    await until(() => link.status === 'connected');
    game2.close();
    // A second phone takes the room: this one is told so and does not fight back.
    const other = new PadLink({ url, room: 'QRST', createSocket: (u) => new WebSocket(u) });
    other.start();
    await until(() => link.status === 'replaced');
    other.stop();
    assert.deepEqual(statuses.slice(0, 2), ['connecting', 'connected']);
  } finally {
    link.stop();
    relay.close();
    await new Promise((r) => server.close(r));
  }
});
