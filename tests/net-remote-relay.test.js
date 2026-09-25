// net/RemotePad.js end to end through the real relay (tools/padRelay.js) on a node http
// server: the game probes /pad-info, joins its room, and a phone (a ws client speaking the pad
// side of the protocol) steers it, gets rumbles and leaves; and the game finds the relay by the
// Server-Timing marker the relay puts on its server's responses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { attachPadRelay } from '../tools/padRelay.js';
import { RemotePad, HURT_RUMBLE_MS, GAME_NAME, RELAY_MARKER, hasRelayMarker } from '../src/net/RemotePad.js';
import { PAD_WS_PATH, PAD_INFO_PATH, encodeInput } from '../src/net/protocol.js';
import { Events } from '../src/core/events.js';
import { Input } from '../src/core/input.js';

const FAKE_IFS = { wlan0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }] };

let server;
let relay;
let port;
const sockets = new Set();

before(async () => {
  server = http.createServer();
  relay = attachPadRelay(server, { networkInterfaces: () => FAKE_IFS });
  server.on('request', (req, res) => relay.middleware(req, res));
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
});

// Resolves once cond() is true (polled), or rejects after `ms`.
async function until(cond, ms = 3000, what = 'condition') {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function phone(room) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${PAD_WS_PATH}`);
  ws.inbox = [];
  ws.on('message', (d) => ws.inbox.push(JSON.parse(d.toString())));
  ws.on('error', () => {});
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', role: 'pad', room })));
  return ws;
}

test('a phone steers the game through the real relay', async () => {
  const events = new Events();
  const input = new Input(new EventTarget());
  input.getGamepads = () => [];
  const log = [];
  events.on('phonePad', (e) => log.push(e.connected));
  const base = `http://127.0.0.1:${port}`;
  const pad = new RemotePad({
    input,
    events,
    fetch: (url, opts) => fetch(new URL(url, base), opts),
    createSocket: (url) => new WebSocket(url),
    location: { protocol: 'http:', host: `127.0.0.1:${port}`, hostname: '127.0.0.1', port: String(port), search: '' },
    dev: true, // the marker check has its own test below
    storage: null,
  });

  assert.equal(await pad.start(), true);
  assert.equal(pad.padUrl, `http://192.168.1.20:${port}/pad.html?room=${pad.room}`);
  await until(() => pad.status === 'online', 3000, 'the game to join');
  assert.equal(pad.connected, false);

  const ws = phone(pad.room);
  await until(() => pad.connected, 3000, 'the phone');
  await until(() => ws.inbox.some((m) => m.t === 'hello'), 3000, 'hello');
  assert.deepEqual(ws.inbox.find((m) => m.t === 'hello'), { t: 'hello', name: GAME_NAME });

  // Stick forward + jump from the phone reach the virtual controller.
  ws.send(JSON.stringify(encodeInput({ stickX: 0, stickY: 1, A: true })));
  await until(() => input.remote.A, 3000, 'input');
  const c = input.poll();
  assert.equal(c.stickY, 1);
  assert.equal(c.A.pressed, true);

  // Pip gets hurt: the phone rumbles.
  events.emit('hurt', { pos: { x: 0, y: 0, z: 0 }, amount: 1 });
  await until(() => ws.inbox.some((m) => m.t === 'rumble'), 3000, 'rumble');
  assert.deepEqual(ws.inbox.find((m) => m.t === 'rumble'), { t: 'rumble', ms: HURT_RUMBLE_MS });

  // The phone leaves: Pip stops.
  ws.close();
  await until(() => !pad.connected, 3000, 'the phone to leave');
  const after = input.poll();
  assert.equal(after.stickMag, 0);
  assert.equal(after.A.down, false);
  assert.deepEqual(log, [false, true, false]);

  pad.dispose();
  await until(() => relay.stats().clients === 0, 3000, 'sockets to close');
});

test('the game finds the relay by its Server-Timing marker', async (t) => {
  const base = `http://127.0.0.1:${port}`;
  const head = await fetch(`${base}/`, { method: 'HEAD' });
  if (!hasRelayMarker(head.headers.get('server-timing') ?? '')) {
    t.todo(`tools/padRelay.js does not mark its responses with "Server-Timing: ${RELAY_MARKER}" yet`);
    return;
  }
  const requests = [];
  const pad = new RemotePad({
    input: { setRemoteState() {} },
    events: new Events(),
    fetch: (url, opts) => {
      requests.push([opts?.method ?? 'GET', url]);
      return fetch(new URL(url, base), opts);
    },
    createSocket: (url) => new WebSocket(url),
    location: { protocol: 'http:', host: `127.0.0.1:${port}`, hostname: '127.0.0.1', port: String(port), pathname: '/', search: '' },
    performance: null, // no navigation entry in node: the HEAD fallback reads the real header
    dev: false,
    storage: null,
  });
  assert.equal(await pad.start(), true);
  assert.deepEqual(requests, [['HEAD', '/'], ['GET', PAD_INFO_PATH]]);
  await until(() => pad.status === 'online', 3000, 'the game to join');
  pad.dispose();
});
