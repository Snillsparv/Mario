// The game's side of the phone controller: a phone on the same network steers Pip through the
// relay in the local dev / preview server (tools/padRelay.js; protocol: net/protocol.js).
//
//   const remotePad = new RemotePad({ input, events });
//   remotePad.start();          // probe the relay; resolves to remotePad.available
//   remotePad.available         // the relay answered: the phone panel may be shown
//   remotePad.room              // 4-letter room code ('ABCD'), kept across reconnects/reloads
//   remotePad.padUrl            // first pad page URL + '?room=' + code (the QR code's text)
//   remotePad.urls              // every pad page URL the relay suggested
//   remotePad.connected         // a phone is in the room
//   remotePad.dispose()
//
// start() looks for the relay without a request that can fail, so a static host (which has no
// relay) never shows a failed request in the console: the relay marks every response of the
// server it runs in with a `Server-Timing: pad-relay` header (RELAY_MARKER), which the game
// reads off this page's own navigation entry (or, where a browser keeps Server-Timing to secure
// contexts, e.g. a LAN address over plain http, off a HEAD of this page, which the server just
// served). Only a marked page (or the Vite dev server, which always runs the relay) then GETs
// PAD_INFO_PATH, with a short timeout. Any failure (no answer, bad JSON, no URLs) leaves
// `available` false and is silent: nothing is logged. ?pad=1 skips the marker check,
// ?pad=0 turns the phone controller off.
//
// When available it creates a room code, opens a WebSocket to PAD_WS_PATH on the page's host,
// joins as 'game' and reconnects with a growing, jittered delay whenever the socket drops (the
// same room, so a phone that already scanned the code comes back by itself). The code is kept
// in sessionStorage, so reloading the game keeps it too. Closed with 4000 (another game took the
// room, e.g. a duplicated tab) it picks a new code instead of taking the room back.
//
// Relay messages:
//   { t: 'peer', connected }  a phone joined / left -> `connected`; joining is answered with
//                             { t: 'hello', name }; leaving releases the phone's controls
//   { t: 'input', s }         -> input.setRemoteState(decodeInput(msg)) (malformed: ignored)
// A phone that stays silent for INPUT_STALE_MS (it resends its state every 100 ms; a locked
// screen or lost Wi-Fi stops that) has its controls released too, so Pip never keeps running.
// Game events: 'hurt' -> { t: 'rumble', ms: HURT_RUMBLE_MS } to the phone.
//
// Events emitted: 'phonePad' { connected, available, room, padUrl } whenever one of those
// changes, and 'remotePress' / 'remoteRelease' { button } on the phone's button edges (the title
// screen starts the game from them; in play the buttons reach Pip through input.poll()).

import { PAD_WS_PATH, PAD_INFO_PATH, PAD_BUTTONS, makeRoomCode, isRoomCode, decodeInput } from './protocol.js';

export const INFO_TIMEOUT_MS = 2000;
export const RETRY_FIRST_MS = 1000;
export const RETRY_MAX_MS = 15000;
export const INPUT_STALE_MS = 1500;
export const HURT_RUMBLE_MS = 120;
export const GAME_NAME = 'Castle Grounds';
export const CLOSE_REPLACED = 4000; // tools/padRelay.js CLOSE_CODES.REPLACED
const ROOM_KEY = 'castleGrounds.padRoom';
const OPEN = 1; // WebSocket.OPEN

// The Server-Timing metric the relay (tools/padRelay.js) puts on every response of its server.
export const RELAY_MARKER = 'pad-relay';

// How to look for the relay from a page at `loc` ({ protocol, search }): 'off' (?pad=0, or a
// page not served over http(s)), 'force' (?pad=1: ask PAD_INFO_PATH whatever the server is) or
// 'marker' (ask only when the server marks its responses with RELAY_MARKER).
export function probeMode(loc) {
  if (!loc) return 'off';
  let flag = null;
  try {
    flag = new URLSearchParams(loc.search || '').get('pad');
  } catch {
    flag = null;
  }
  if (flag === '0') return 'off';
  if (flag !== null) return 'force';
  return loc.protocol === 'http:' || loc.protocol === 'https:' ? 'marker' : 'off';
}

// Whether server timings carry RELAY_MARKER: a Server-Timing header value
// ('pad-relay, db;dur=53') or a navigation entry's serverTiming list ([{ name }]).
export function hasRelayMarker(timing) {
  if (Array.isArray(timing)) return timing.some((m) => m?.name === RELAY_MARKER);
  if (typeof timing !== 'string') return false;
  return timing.split(',').some((metric) => metric.split(';')[0].trim() === RELAY_MARKER);
}

// The relay's socket URL on the server that served the page.
export function gameSocketUrl(loc) {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${PAD_WS_PATH}`;
}

// The pad page URLs from a PAD_INFO_PATH answer (http(s) only), or [] when it is not one.
export function parsePadInfo(info) {
  if (!info || typeof info !== 'object' || !Array.isArray(info.urls)) return [];
  const out = [];
  for (const u of info.urls) {
    if (typeof u !== 'string' || u.length > 300) continue;
    try {
      const url = new URL(u);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !out.includes(url.href)) out.push(url.href);
    } catch {
      // not a URL
    }
  }
  return out;
}

// `url` with ?room=CODE (replacing any room already in it).
export function withRoom(url, room) {
  try {
    const u = new URL(url);
    u.searchParams.set('room', room);
    return u.href;
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}room=${room}`;
  }
}

// Reconnect delay after `failures` (1, 2, ...) attempts in a row: doubling up to RETRY_MAX_MS,
// +-15% jitter.
export function reconnectDelay(failures, rng = Math.random) {
  const base = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (0.85 + 0.3 * rng()));
}

function browserStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null; // blocked storage throws on access
  }
}

export class RemotePad {
  // Injectable for tests: fetch, createSocket(url), location, performance ({ getEntriesByType }),
  // dev (served by the Vite dev server), timers { setTimeout, clearTimeout }, rng(), storage
  // (sessionStorage-like), infoTimeoutMs.
  constructor({ input, events, fetch, createSocket, location, performance, dev, timers, rng, storage, infoTimeoutMs = INFO_TIMEOUT_MS } = {}) {
    this.input = input;
    this.events = events;
    this.fetch = fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    this.createSocket = createSocket ?? ((url) => new WebSocket(url));
    this.location = location ?? globalThis.location ?? null;
    this.performance = performance === undefined ? (globalThis.performance ?? null) : performance;
    // The dev server always runs the relay (vite.config.js); in Node import.meta.env is unset.
    this.dev = dev ?? !!import.meta.env?.DEV;
    this.timers = timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };
    this.rng = rng ?? Math.random;
    this.storage = storage === undefined ? browserStorage() : storage;
    this.infoTimeoutMs = infoTimeoutMs;

    this.available = false;
    this.urls = [];
    this.room = null;
    this.connected = false; // a phone is in the room
    this.status = 'off'; // 'off' | 'probing' | 'unavailable' | 'connecting' | 'online' | 'offline' | 'stopped'
    this.failures = 0; // connection attempts in a row that never joined
    this.ws = null;
    this._retryTimer = null;
    this._staleTimer = null;
    this._buttons = {}; // the phone's buttons as last applied (for press / release events)
    this._started = null;
    this._disposed = false;
    this._unsubs = [
      events?.on?.('hurt', () => this.rumble(HURT_RUMBLE_MS)),
    ].filter(Boolean);
  }

  get padUrl() {
    return this.available && this.room && this.urls.length ? withRoom(this.urls[0], this.room) : null;
  }

  // Probe the relay once (later calls return the same promise). Resolves to `available`.
  start() {
    this._started ??= this._probe().then((urls) => {
      if (this._disposed) return false;
      if (!urls.length) {
        this.status = 'unavailable';
        return false;
      }
      this.urls = urls;
      this.available = true;
      this.room = this._loadRoom();
      this._emit();
      this._connect();
      return true;
    });
    return this._started;
  }

  // Ask the phone to vibrate (ignored when no phone is connected).
  rumble(ms) {
    if (this.connected) this._send({ t: 'rumble', ms: Math.max(0, Math.round(ms)) });
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.status = 'stopped';
    this._unsubs.forEach((off) => off?.());
    this._clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      this._detach(ws);
      try {
        ws.close(1000, 'game closed');
      } catch {
        // already closed
      }
    }
    this._setConnected(false);
  }

  // ---- internals ----------------------------------------------------------------------------

  async _probe() {
    const loc = this.location;
    const mode = probeMode(loc);
    if (!this.fetch || mode === 'off') return [];
    this.status = 'probing';
    if (mode === 'marker' && !this.dev && !(await this._relayMarked())) return [];
    const info = await this._request(PAD_INFO_PATH, { cache: 'no-store', headers: { Accept: 'application/json' } }, (res) =>
      res.ok ? res.json() : null, // an HTML fallback page throws in json()
    );
    return parsePadInfo(info);
  }

  // Whether the server that served this page carries the relay (RELAY_MARKER on its responses).
  async _relayMarked() {
    let nav = null;
    try {
      nav = this.performance?.getEntriesByType?.('navigation')?.[0] ?? null;
    } catch {
      nav = null;
    }
    if (nav && Array.isArray(nav.serverTiming)) return hasRelayMarker(nav.serverTiming);
    // Server timings are not exposed here (some browsers keep them to secure contexts): read the
    // header off this page itself, which cannot 404 (the server has just served it).
    const loc = this.location;
    const page = `${loc.pathname || '/'}${loc.search || ''}`;
    const header = await this._request(page, { method: 'HEAD', cache: 'no-store' }, (res) => res.headers?.get?.('server-timing') ?? '');
    return hasRelayMarker(header);
  }

  // fetch(url, opts) -> read(response), or null on any failure or after infoTimeoutMs (aborted).
  async _request(url, opts, read) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => {
        try {
          ctrl?.abort();
        } catch {
          // nothing to abort
        }
        resolve(null);
      }, this.infoTimeoutMs);
    });
    const request = (async () => {
      try {
        const res = await this.fetch(url, { ...opts, signal: ctrl?.signal });
        return res ? await read(res) : null;
      } catch {
        return null;
      }
    })();
    const out = await Promise.race([request, timeout]);
    this.timers.clearTimeout(timer);
    return out;
  }

  _loadRoom() {
    try {
      const saved = this.storage?.getItem(ROOM_KEY);
      if (isRoomCode(saved)) return saved;
    } catch {
      // storage blocked
    }
    return this._newRoom();
  }

  _newRoom() {
    const room = makeRoomCode(this.rng);
    try {
      this.storage?.setItem(ROOM_KEY, room);
    } catch {
      // storage blocked or full: the code just does not survive a reload
    }
    return room;
  }

  _connect() {
    if (this._disposed || !this.available) return;
    this._retryTimer = null;
    this.status = 'connecting';
    let ws;
    try {
      ws = this.createSocket(gameSocketUrl(this.location));
    } catch {
      this._scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this._send({ t: 'join', role: 'game', room: this.room });
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      let msg = null;
      try {
        msg = typeof e.data === 'string' ? JSON.parse(e.data) : null;
      } catch {
        msg = null;
      }
      if (msg && typeof msg === 'object') this._onMessage(msg);
    };
    // An error is always followed by a close; the browser has already reported it.
    ws.onerror = () => {};
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this._detach(ws);
      this.ws = null;
      this._setConnected(false);
      if (this._disposed) return;
      if (e?.code === CLOSE_REPLACED) {
        // Another game page joined with this code (a duplicated tab): make our own room.
        this.room = this._newRoom();
        this.failures = 0;
        this._emit();
      }
      this._scheduleRetry();
    };
  }

  _detach(ws) {
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
  }

  _scheduleRetry() {
    this.status = 'offline';
    this.failures++;
    this.timers.clearTimeout(this._retryTimer);
    this._retryTimer = this.timers.setTimeout(() => this._connect(), reconnectDelay(this.failures, this.rng));
  }

  _onMessage(msg) {
    if (msg.t === 'peer') {
      // The relay's answer to the join, and every phone arriving or leaving later.
      this.status = 'online';
      this.failures = 0;
      this._setConnected(!!msg.connected);
      if (msg.connected) this._send({ t: 'hello', name: GAME_NAME });
    } else if (msg.t === 'input') {
      const state = decodeInput(msg);
      if (!state) return;
      if (!this.connected) this._setConnected(true); // input implies a phone, even before its peer note
      this._apply(state);
      this.timers.clearTimeout(this._staleTimer);
      this._staleTimer = this.timers.setTimeout(() => this._apply(null), INPUT_STALE_MS);
    }
  }

  // Feed the phone's state to the game (null releases everything) and report button edges.
  _apply(state) {
    this.input?.setRemoteState(state);
    for (const b of PAD_BUTTONS) {
      const down = !!state?.[b];
      if (down === !!this._buttons[b]) continue;
      this._buttons[b] = down;
      this.events?.emit(down ? 'remotePress' : 'remoteRelease', { button: b });
    }
  }

  _setConnected(on) {
    if (!on) {
      this.timers.clearTimeout(this._staleTimer);
      this._staleTimer = null;
      this._apply(null); // Pip must not keep running on a phone that left
    }
    if (on === this.connected) return;
    this.connected = on;
    this._emit();
  }

  _send(msg) {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  _clearTimers() {
    this.timers.clearTimeout(this._retryTimer);
    this.timers.clearTimeout(this._staleTimer);
    this._retryTimer = null;
    this._staleTimer = null;
  }

  _emit() {
    this.events?.emit('phonePad', { connected: this.connected, available: this.available, room: this.room, padUrl: this.padUrl });
  }
}
