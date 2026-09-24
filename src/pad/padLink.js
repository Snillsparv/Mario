// The phone pad's connection to the game (no DOM: node tests drive it with a fake socket and
// fake timers). Protocol: src/net/protocol.js; relay: tools/padRelay.js.
//
//   const link = new PadLink({ url, room, onStatus, onRumble })
//   link.start()            connect, send { t: 'join', role: 'pad', room }, then the state
//   link.setState(state)    the controller changed (TouchController's sink)
//   link.wake()             the page is visible / online again: retry now if waiting to
//   link.retryNow()         the player asked to reconnect (also after being replaced)
//   link.stop()             send a neutral state, close, no more retries
//   link.status             'idle' | 'connecting' | 'waiting' | 'connected' | 'reconnecting'
//                           | 'replaced' | 'stopped'
//
// Sending: every change of the buttons goes out at once (a tap shorter than a message interval
// is never merged away: the game sees the press and the release); a stick-only change waits
// until STICK_MIN_MS after the last message (the newest value then goes; the game simulates at
// 30 Hz, and the relay allows about 60 messages a second per socket). While the socket is open
// the current state is resent whenever nothing went out for HEARTBEAT_MS.
//
// Statuses: 'connecting' until the relay answers the join with { t: 'peer' }; then
// 'connected' (the game is in the room; also on { t: 'hello' }) or 'waiting' (no game with
// that code yet). A lost or failed socket is retried after RETRY_FIRST_MS, doubling up to
// RETRY_MAX_MS ('reconnecting'; `failures` counts the attempts in a row that failed). Closed
// with CLOSE_REPLACED (another phone joined the same game): 'replaced', and no automatic retry,
// or two phones would keep taking the seat from each other.

import { encodeInput, PAD_WS_PATH } from '../net/protocol.js';

export const STICK_MIN_MS = 33;
export const HEARTBEAT_MS = 100;
export const CONNECT_TIMEOUT_MS = 6000;
export const JOIN_ACK_MS = 2500; // no answer to the join: assume the game is not there yet
export const RETRY_FIRST_MS = 500;
export const RETRY_MAX_MS = 5000;
export const RUMBLE_MAX_MS = 2000;
export const CLOSE_REPLACED = 4000; // tools/padRelay.js CLOSE_CODES.REPLACED
const MAX_BUFFERED = 4096; // bytes queued on the socket before stick-only updates are skipped
const OPEN = 1; // WebSocket.OPEN

// ws:// or wss:// URL of the relay on the server that served the page.
export function padSocketUrl(loc) {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${PAD_WS_PATH}`;
}

// Delay before retry number `failures` (1, 2, ...): RETRY_FIRST_MS doubling up to RETRY_MAX_MS,
// +-15% jitter so many pads do not retry in step.
export function retryDelay(failures, rng = Math.random) {
  const base = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (0.85 + 0.3 * rng()));
}

const NEUTRAL = encodeInput({});

export class PadLink {
  // url: relay socket URL; room: 4-letter code. Injectable for tests: createSocket(url),
  // timers { setTimeout, clearTimeout }, now() (ms), rng(). Callbacks: onStatus(status, link),
  // onRumble(ms), onSend(message) (after each input message).
  constructor({ url, room, createSocket, timers, now, rng, onStatus, onRumble, onSend } = {}) {
    this.url = url;
    this.room = room;
    this.createSocket = createSocket ?? ((u) => new WebSocket(u));
    this.timers = timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };
    this.now = now ?? (() => Date.now());
    this.rng = rng ?? Math.random;
    this.onStatus = onStatus;
    this.onRumble = onRumble;
    this.onSend = onSend;
    this.status = 'idle';
    this.failures = 0;
    this.gameName = '';
    this.ws = null;
    this.joined = false; // the join went out on the current socket
    this.current = NEUTRAL; // latest controller state (encoded)
    this.sent = null; // last input message sent on this socket
    this.sentAt = -Infinity;
    this.sends = 0;
    this._t = {}; // timer ids: retry, connect, ack, flush, beat
  }

  start() {
    if (this.status !== 'idle' && this.status !== 'stopped') return;
    this.failures = 0;
    this._connect();
  }

  // Let go of the game: a neutral state first, so Pip does not keep running.
  stop() {
    if (this.status === 'stopped') return;
    this.current = NEUTRAL;
    if (this.joined) this._send();
    const ws = this.ws;
    this._drop();
    this._clear('retry');
    try {
      ws?.close(1000, 'pad closed');
    } catch {
      // already closing
    }
    this._setStatus('stopped');
  }

  // Back in view or online: a pending retry runs now (not after being replaced).
  wake() {
    if (this.status === 'reconnecting' && !this.ws) this._connect();
  }

  // The player asked for it: connect now unless already connecting or connected.
  retryNow() {
    if (this.status === 'stopped' || this.status === 'idle' || this.ws) return;
    this._connect();
  }

  setState(state) {
    const msg = encodeInput(state);
    const [x, y, bits] = msg.s;
    const cur = this.current.s;
    if (x === cur[0] && y === cur[1] && bits === cur[2]) return;
    this.current = msg;
    if (!this.joined) return; // goes out right after the join
    const buttons = !this.sent || bits !== this.sent.s[2];
    if (buttons) {
      this._send();
      return;
    }
    if (this._congested()) return; // a slow network: the heartbeat takes the newest state
    const wait = this.sentAt + STICK_MIN_MS - this.now();
    if (wait <= 0) this._send();
    else if (this._t.flush === undefined) this._t.flush = this.timers.setTimeout(() => this._flush(), wait);
  }

  // ---- internals ------------------------------------------------------------------------

  _congested() {
    return (this.ws?.bufferedAmount ?? 0) > MAX_BUFFERED;
  }

  _flush() {
    this._t.flush = undefined;
    if (this.joined && this.current !== this.sent) this._send();
  }

  _send() {
    const ws = this.ws;
    if (!ws || !this.joined || ws.readyState !== OPEN) return false;
    try {
      ws.send(JSON.stringify(this.current));
    } catch {
      return false; // closing: the close event follows
    }
    this.sent = this.current;
    this.sentAt = this.now();
    this.sends++;
    this._clear('flush');
    this._clear('beat');
    this._t.beat = this.timers.setTimeout(() => {
      this._t.beat = undefined;
      this._send();
    }, HEARTBEAT_MS);
    this.onSend?.(this.sent);
    return true;
  }

  _connect() {
    this._clear('retry');
    this._setStatus(this.failures > 0 ? 'reconnecting' : 'connecting');
    let ws;
    try {
      ws = this.createSocket(this.url);
    } catch {
      this.ws = null;
      this._retryLater();
      return;
    }
    this.ws = ws;
    this.joined = false;
    this.sent = null;
    this._t.connect = this.timers.setTimeout(() => {
      this._t.connect = undefined;
      if (ws === this.ws && ws.readyState !== OPEN) this._lost(ws, 0, true); // stuck (unreachable address)
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this._clear('connect');
      try {
        ws.send(JSON.stringify({ t: 'join', role: 'pad', room: this.room }));
      } catch {
        return; // the close event follows
      }
      this.joined = true;
      this.failures = 0;
      this._t.ack = this.timers.setTimeout(() => {
        this._t.ack = undefined;
        if (ws === this.ws && this.status !== 'connected') this._setStatus('waiting');
      }, JOIN_ACK_MS);
      this._send();
    };
    ws.onmessage = (e) => {
      if (ws === this.ws) this._message(e?.data);
    };
    ws.onclose = (e) => this._lost(ws, e?.code);
    ws.onerror = () => {}; // a close event follows
  }

  _message(data) {
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'peer') {
      this._clear('ack');
      if (!msg.connected) this.gameName = '';
      this._setStatus(msg.connected ? 'connected' : 'waiting');
    } else if (msg.t === 'hello') {
      this._clear('ack');
      this.gameName = typeof msg.name === 'string' ? msg.name.slice(0, 32) : '';
      this._setStatus('connected', true);
    } else if (msg.t === 'rumble') {
      const ms = Number(msg.ms);
      if (Number.isFinite(ms) && ms > 0) this.onRumble?.(Math.round(Math.min(RUMBLE_MAX_MS, ms)));
    }
  }

  // The socket closed (or never opened). `close`: close it ourselves (connect timeout).
  _lost(ws, code, close = false) {
    if (ws !== this.ws) return; // an old socket
    this._drop();
    if (close) {
      try {
        ws.close();
      } catch {
        // never opened
      }
    }
    if (this.status === 'stopped') return;
    if (code === CLOSE_REPLACED) {
      this.failures = 0;
      this._setStatus('replaced');
      return;
    }
    this._retryLater();
  }

  _retryLater() {
    this.failures++;
    this._setStatus('reconnecting', true);
    this._clear('retry');
    this._t.retry = this.timers.setTimeout(() => {
      this._t.retry = undefined;
      this._connect();
    }, retryDelay(this.failures, this.rng));
  }

  // Forget the socket and its timers (not a pending retry).
  _drop() {
    const ws = this.ws;
    if (ws) ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    this.ws = null;
    this.joined = false;
    this.sent = null;
    for (const name of ['connect', 'ack', 'flush', 'beat']) this._clear(name);
  }

  _clear(name) {
    if (this._t[name] === undefined) return;
    this.timers.clearTimeout(this._t[name]);
    this._t[name] = undefined;
  }

  _setStatus(status, always = false) {
    if (status === this.status && !always) return;
    this.status = status;
    this.onStatus?.(status, this);
  }
}
