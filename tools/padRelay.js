// Phone-as-controller relay for the local dev / preview server (a Vite plugin).
//
// The game page and the phone's pad page (pad.html) both open a WebSocket to PAD_WS_PATH on
// the computer that serves the game; this relay pairs them by room code and passes messages
// between them (protocol: src/net/protocol.js). It exists only in `npm run dev` and
// `npm run preview`; a static host has no relay, so GET PAD_INFO_PATH fails there and the game
// keeps its phone panel hidden.
//
// WebSocket PAD_WS_PATH (only this path is taken; Vite's own HMR socket is left alone):
//   first message must be { t: 'join', role: 'game' | 'pad', room } with isRoomCode(room)
//   one game + one pad per room; a newer one replaces (closes) the older one
//   pad  -> game: 'input' only (decoded + re-encoded, junk dropped)
//   game -> pad : 'rumble' { ms } (0-2000) and 'hello' { name } (<= 32 chars) only
//   relay -> joiner: { t: 'peer', connected } right after the join (doubles as the join ack)
//   relay -> other : { t: 'peer', connected: true } on a join, { connected: false } on a leave
// Close codes a page can act on:
//   4000 replaced (another pad/game took the room: do NOT auto-reconnect, or two phones
//        keep kicking each other out), 4001 bad or missing join, 4002 no join in time,
//   4003 relay full (too many rooms / sockets), 1008 flooding, 1009 message too big,
//   1001 server shutting down.
// Limits: messages <= 1 KB; per socket ~60 msgs/s (a burst of 60, then 60/s: extra inputs
// are coalesced into the latest one, which is delivered as soon as the budget allows, other
// extras are dropped; more than 4x the rate in one second closes the socket); <= 50 rooms;
// <= 200 sockets; heartbeat pings every 10 s drop sockets that stop answering.
//
// HTTP GET PAD_INFO_PATH -> { urls: ['http://192.168.1.20:5173/pad.html', ...] }: the pad page
// on every non-internal IPv4 address of this machine the server listens on (likely home/office
// LAN addresses first, VPN / container / link-local ones last) at the port it listens on, then
// the URL from the request's Host header as a fallback. Only addresses a phone could reach are
// offered: never a loopback or localhost one. When there is none, `urls` is empty and `reason`
// says why: 'loopback' (the server listens on this computer only, e.g. `--host 127.0.0.1` or
// `--host localhost`: restart it with `--host`) or 'no-network' (no network address found).
// The game appends ?room=CODE for the QR code.
//
// Every response of the server the relay runs in carries `Server-Timing: pad-relay`
// (RELAY_MARKER), so the game can tell a relay server from a static host (which has no relay)
// without a request that could fail there (src/net/RemotePad.js).

import os from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import {
  PAD_WS_PATH,
  PAD_INFO_PATH,
  PAD_PAGE,
  isRoomCode,
  decodeInput,
  encodeInput,
} from '../src/net/protocol.js';

export const RELAY_LIMITS = Object.freeze({
  maxPayload: 1024, // bytes per message
  maxMsgsPerSec: 60, // per socket: token bucket rate and burst size
  floodFactor: 4, // more than maxMsgsPerSec * floodFactor in one second -> close
  maxRooms: 50,
  maxClients: 200, // open sockets, joined or not
  joinTimeoutMs: 10000,
  heartbeatMs: 10000,
  maxRumbleMs: 2000,
  maxNameLength: 32,
});

export const CLOSE_CODES = Object.freeze({
  REPLACED: 4000,
  BAD_JOIN: 4001,
  JOIN_TIMEOUT: 4002,
  FULL: 4003,
  FLOOD: 1008,
  TOO_BIG: 1009,
  SHUTDOWN: 1001,
});

// The Server-Timing metric on every response of the relay's server (src/net/RemotePad.js
// RELAY_MARKER).
export const RELAY_MARKER = 'pad-relay';

const OTHER = { game: 'pad', pad: 'game' };

function pathOf(url) {
  try {
    return new URL(`http://relay.invalid${url || '/'}`).pathname;
  } catch {
    return '';
  }
}

// Browsers send Origin on WebSocket upgrades: only accept pages served by this same server,
// so another web site open on the computer cannot join rooms. Non-browser clients send none.
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(`http://${req.headers.host}`).host;
  } catch {
    return false;
  }
}

function rejectUpgrade(socket, status, text) {
  try {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    socket.destroy();
  }
}

// ---- pad page URLs -------------------------------------------------------------------------

const VIRTUAL_IF =
  /^(docker|br-|veth|virbr|vboxnet|vmnet|vethernet|utun|tun|tap|zt|tailscale|wg|lxc|lxd|podman|cni|flannel|awdl|llw|ham)|virtual|vmware|hyper-v|wsl|loopback|pseudo/i;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function addressRank(ip) {
  const [a, b] = ip.split('.').map(Number);
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 2;
  if (a === 169 && b === 254) return 20; // link-local: no DHCP, rarely reachable
  if (a === 100 && b >= 64 && b <= 127) return 6; // carrier-grade NAT / VPN overlays
  return 4; // public address
}

// '::ffff:192.168.1.20' (an IPv4 address on a dual-stack socket) -> '192.168.1.20'.
const unmapV4 = (ip) => String(ip ?? '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

// Whether a listen address or host name only reaches this computer (or no computer at all:
// the unspecified address), so it is no use to a phone.
export function isLoopbackHost(host) {
  const h = unmapV4(String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')).replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (IPV4.test(h)) return h.startsWith('127.') || h === '0.0.0.0';
  // IPv6 loopback ('::1', '0:0:0:0:0:0:0:1') or unspecified ('::').
  return h.includes(':') && (/^[0:]*:0*1$/.test(h) || /^[0:]+$/.test(h));
}

// Host header ('mybox.local:5173', '[::1]:5173') -> host name ('mybox.local', '::1').
function hostName(host) {
  const m = /^\[([^\]]*)\]/.exec(host);
  if (m) return m[1];
  const parts = host.split(':');
  return parts.length === 2 ? parts[0] : host; // several colons: a bare IPv6 address
}

// The pad page URLs a phone could open, best guess first, and why there are none.
//   interfaces: os.networkInterfaces() shape; port: the port the server listens on;
//   host: the request's Host header (fallback URL); address: the address the server listens on
//   (httpServer.address().address; '::' / '0.0.0.0' / undefined: every interface).
// -> { urls, reason } with reason null, 'loopback' or 'no-network' (only when urls is empty).
export function padInfo({ interfaces = {}, port, scheme = 'http', host, address } = {}) {
  const listen = unmapV4(address ?? '').toLowerCase();
  const everywhere = !listen || listen === '::' || listen === '0.0.0.0';
  const loopbackOnly = !everywhere && isLoopbackHost(listen);
  const found = [];
  if (everywhere) {
    for (const [name, addrs] of Object.entries(interfaces || {})) {
      for (const a of addrs || []) {
        if (!a || a.internal || !(a.family === 'IPv4' || a.family === 4)) continue;
        if (!IPV4.test(a.address) || isLoopbackHost(a.address)) continue;
        const score = addressRank(a.address) + (VIRTUAL_IF.test(name) ? 10 : 0);
        found.push({ ip: a.address, score, i: found.length });
      }
    }
    found.sort((x, y) => x.score - y.score || x.i - y.i);
  } else if (IPV4.test(listen) && !loopbackOnly) {
    found.push({ ip: listen }); // bound to one address: only that one answers
  }
  const urls = [];
  const add = (u) => {
    if (!urls.includes(u)) urls.push(u);
  };
  const portPart = Number.isInteger(port) && port > 0 ? `:${port}` : '';
  for (const f of found) add(`${scheme}://${f.ip}${portPart}/${PAD_PAGE}`);
  // The address this page was opened at, unless only this computer can use it. (Behind a
  // proxy or tunnel that is how the phone gets in, even to a loopback-only server.)
  if (
    typeof host === 'string' &&
    /^[A-Za-z0-9.\-:[\]]{1,255}$/.test(host) &&
    !isLoopbackHost(hostName(host))
  ) {
    add(`${scheme}://${host}/${PAD_PAGE}`);
  }
  let reason = null;
  if (!urls.length) reason = loopbackOnly ? 'loopback' : 'no-network';
  return { urls, reason };
}

// padInfo(...).urls.
export function padPageUrls(options) {
  return padInfo(options).urls;
}

// ---- relay ---------------------------------------------------------------------------------

// Sanitised game -> pad message (JSON string) or null.
function gameToPad(msg, opts) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.t === 'rumble') {
    if (typeof msg.ms !== 'number' || !Number.isFinite(msg.ms)) return null;
    const ms = Math.round(Math.max(0, Math.min(opts.maxRumbleMs, msg.ms)));
    return JSON.stringify({ t: 'rumble', ms });
  }
  if (msg.t === 'hello') {
    const name =
      typeof msg.name === 'string'
        ? msg.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, opts.maxNameLength)
        : '';
    return JSON.stringify({ t: 'hello', name });
  }
  return null;
}

// Marks a response as coming from a server with the relay (Server-Timing: RELAY_MARKER).
function markResponse(res) {
  try {
    const prev = res.getHeader('Server-Timing');
    if (prev === undefined) {
      res.setHeader('Server-Timing', RELAY_MARKER);
    } else if (!String(prev).split(',').some((m) => m.split(';')[0].trim() === RELAY_MARKER)) {
      res.setHeader('Server-Timing', `${prev}, ${RELAY_MARKER}`);
    }
  } catch {
    // headers already sent
  }
}

// Attaches the relay to a node http(s) server: handles its 'upgrade' events for PAD_WS_PATH
// and returns { middleware(req, res, next), close(), stats() }. The middleware marks every
// response (Server-Timing: RELAY_MARKER), answers PAD_INFO_PATH and passes everything else on.
// options: RELAY_LIMITS overrides, `port` (the pad page port; default: the port the server
// listens on), `networkInterfaces` (default os.networkInterfaces, replaceable in tests) and
// `address` (the address the server listens on; default: the real one, see the middleware).
export function attachPadRelay(httpServer, options = {}) {
  const opts = { ...RELAY_LIMITS, networkInterfaces: () => os.networkInterfaces(), ...options };
  const rooms = new Map(); // code -> { game: client | null, pad: client | null }
  const clients = new Map(); // ws -> client
  let closed = false;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: opts.maxPayload,
    perMessageDeflate: false,
    clientTracking: false,
  });

  const send = (c, data) => {
    const ws = c && c.ws;
    // Skip a slow reader instead of queueing without bound.
    if (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 16384) ws.send(data);
  };
  const peerMsg = (connected) => JSON.stringify({ t: 'peer', connected });

  // Token bucket: up to maxMsgsPerSec at once, refilled at maxMsgsPerSec per second.
  const refill = (c, now) => {
    const rate = opts.maxMsgsPerSec;
    c.tokens = Math.min(rate, c.tokens + ((now - c.last) * rate) / 1000);
    c.last = now;
  };
  const flushPending = (c) => {
    c.flushTimer = null;
    if (!c.pending) return;
    refill(c, Date.now());
    c.tokens = Math.max(0, c.tokens - 1);
    const data = c.pending;
    c.pending = null;
    const room = rooms.get(c.roomCode);
    if (room) send(room.game, data);
  };

  function join(c, msg) {
    const { ws } = c;
    if (
      !msg ||
      msg.t !== 'join' ||
      (msg.role !== 'game' && msg.role !== 'pad') ||
      !isRoomCode(msg.room)
    ) {
      ws.close(CLOSE_CODES.BAD_JOIN, 'expected join');
      return;
    }
    let room = rooms.get(msg.room);
    if (!room) {
      if (rooms.size >= opts.maxRooms) {
        ws.close(CLOSE_CODES.FULL, 'relay full');
        return;
      }
      room = { game: null, pad: null };
      rooms.set(msg.room, room);
    }
    clearTimeout(c.joinTimer);
    const old = room[msg.role];
    if (old) {
      // Detach first so its close does not tell the other side the seat emptied.
      old.roomCode = null;
      old.pending = null;
      clearTimeout(old.flushTimer);
      old.ws.close(CLOSE_CODES.REPLACED, 'replaced');
    }
    c.role = msg.role;
    c.roomCode = msg.room;
    room[c.role] = c;
    const other = room[OTHER[c.role]];
    send(c, peerMsg(!!other));
    if (other) send(other, peerMsg(true));
  }

  function onMessage(c, data, isBinary) {
    const { ws } = c;
    if (ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - c.windowStart >= 1000) {
      c.windowStart = now;
      c.windowCount = 0;
    }
    if (++c.windowCount > opts.maxMsgsPerSec * opts.floodFactor) {
      ws.close(CLOSE_CODES.FLOOD, 'too many messages');
      return;
    }
    let msg = null;
    if (!isBinary) {
      try {
        msg = JSON.parse(data.toString());
      } catch {
        msg = null;
      }
    }
    if (!c.roomCode) {
      if (c.role) return; // replaced, closing
      join(c, msg);
      return;
    }
    const room = rooms.get(c.roomCode);
    if (!room) return;
    refill(c, now);
    if (c.role === 'pad') {
      const state = msg && msg.t === 'input' ? decodeInput(msg) : null;
      if (!state) return;
      const out = JSON.stringify(encodeInput(state));
      if (c.pending) {
        c.pending = out; // keep order: the queued input goes first, this one replaces it
      } else if (c.tokens >= 1) {
        c.tokens -= 1;
        send(room.game, out);
      } else {
        c.pending = out;
        const wait = Math.ceil(((1 - c.tokens) * 1000) / opts.maxMsgsPerSec);
        c.flushTimer = setTimeout(flushPending, wait, c);
      }
    } else {
      const out = gameToPad(msg, opts);
      if (!out || c.tokens < 1) return;
      c.tokens -= 1;
      send(room.pad, out);
    }
  }

  function onClose(c) {
    clients.delete(c.ws);
    clearTimeout(c.joinTimer);
    clearTimeout(c.flushTimer);
    c.pending = null;
    if (!c.roomCode) return;
    const code = c.roomCode;
    c.roomCode = null;
    const room = rooms.get(code);
    if (!room || room[c.role] !== c) return;
    room[c.role] = null;
    const other = room[OTHER[c.role]];
    if (other) {
      if (!closed) send(other, peerMsg(false));
    } else {
      rooms.delete(code);
    }
  }

  function onConnection(ws) {
    const now = Date.now();
    const c = {
      ws,
      role: null,
      roomCode: null,
      alive: true,
      tokens: opts.maxMsgsPerSec,
      last: now,
      windowStart: now,
      windowCount: 0,
      pending: null,
      flushTimer: null,
      joinTimer: null,
    };
    clients.set(ws, c);
    c.joinTimer = setTimeout(() => {
      if (!c.roomCode && ws.readyState === WebSocket.OPEN) {
        ws.close(CLOSE_CODES.JOIN_TIMEOUT, 'join timeout');
      }
    }, opts.joinTimeoutMs);
    c.joinTimer.unref?.();
    ws.on('pong', () => {
      c.alive = true;
    });
    // ws reports protocol errors (e.g. a message over maxPayload) here and closes the socket
    // itself; without a listener the error would crash the dev server.
    ws.on('error', () => {});
    ws.on('message', (data, isBinary) => onMessage(c, data, isBinary));
    ws.on('close', () => onClose(c));
  }

  function onUpgrade(req, socket, head) {
    if (closed || pathOf(req.url) !== PAD_WS_PATH) return; // not ours (e.g. Vite HMR)
    if (!originAllowed(req)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    if (clients.size >= opts.maxClients) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }
    wss.handleUpgrade(req, socket, head, onConnection);
  }

  const heartbeat = setInterval(() => {
    for (const [ws, c] of clients) {
      if (!c.alive) {
        ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, opts.heartbeatMs);
  heartbeat.unref?.();

  function middleware(req, res, next) {
    markResponse(res);
    if (pathOf(req.url) !== PAD_INFO_PATH) {
      if (typeof next === 'function') next();
      else {
        res.statusCode = 404;
        res.end();
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end();
      return;
    }
    const addr = httpServer.address();
    const bound = addr && typeof addr === 'object' ? addr : null;
    const port = opts.port ?? (bound ? bound.port : req.socket.localPort);
    // A test that replaces networkInterfaces describes a pretend machine, which its (loopback)
    // test server cannot really listen on: that machine listens on all of its addresses
    // unless the test also passes `address`.
    const address =
      options.address !== undefined || options.networkInterfaces
        ? options.address
        : bound?.address;
    let interfaces = {};
    try {
      interfaces = opts.networkInterfaces();
    } catch {
      interfaces = {}; // some platforms refuse to list interfaces
    }
    const { urls, reason } = padInfo({
      interfaces,
      port,
      scheme: req.socket.encrypted ? 'https' : 'http',
      host: req.headers.host,
      address,
    });
    const body = JSON.stringify(reason ? { urls, reason } : { urls });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    httpServer.off('upgrade', onUpgrade);
    for (const [ws, c] of clients) {
      clearTimeout(c.joinTimer);
      clearTimeout(c.flushTimer);
      ws.close(CLOSE_CODES.SHUTDOWN, 'server closing');
      setTimeout(() => ws.terminate(), 1000).unref?.();
    }
    rooms.clear();
    wss.close();
  }

  httpServer.on('upgrade', onUpgrade);
  httpServer.once('close', close);

  const stats = () => ({
    rooms: rooms.size,
    clients: clients.size,
    joined: [...rooms.values()].reduce((n, r) => n + !!r.game + !!r.pad, 0),
  });

  return { middleware, close, stats };
}

// Vite plugin: the relay on the dev server (`npm run dev`) and the preview server
// (`npm run preview`). Builds are untouched. In middleware mode (no http server) it does
// nothing.
export default function padRelay(options = {}) {
  const install = (server) => {
    if (!server.httpServer) return;
    const relay = attachPadRelay(server.httpServer, options);
    // Added before Vite's own middlewares (host check and CORS run earlier), so the SPA
    // fallback never answers PAD_INFO_PATH with index.html.
    server.middlewares.use(relay.middleware);
  };
  return {
    name: 'pad-relay',
    configureServer: install,
    configurePreviewServer: install,
  };
}
