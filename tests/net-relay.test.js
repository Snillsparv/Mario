// Phone-controller relay (tools/padRelay.js): rooms, forwarding, peer notices, replacement,
// validation, limits, heartbeat and the pad-info endpoint, on a plain node http server; plus
// the Vite plugin on a real Vite dev server (the relay next to Vite's own HMR socket).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import padRelay, {
  attachPadRelay,
  padPageUrls,
  CLOSE_CODES,
  RELAY_LIMITS,
} from '../tools/padRelay.js';
import { PAD_WS_PATH, PAD_INFO_PATH, encodeInput } from '../src/net/protocol.js';

const FAKE_IFS = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
  wlan0: [
    { address: 'fe80::1', family: 'IPv6', internal: false },
    { address: '192.168.1.20', family: 'IPv4', internal: false },
  ],
};

// A plain http server with the relay attached (the way the Vite hooks attach it).
async function startServer(options = {}) {
  const server = http.createServer();
  const relay = attachPadRelay(server, { networkInterfaces: () => FAKE_IFS, ...options });
  server.on('request', (req, res) => relay.middleware(req, res));
  // Like Vite's close: destroy every open socket (upgraded ones too), then close.
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    server,
    relay,
    port,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

// ws client with a message inbox: next() resolves with the next JSON message.
function connect(port, { path = PAD_WS_PATH, ...wsOptions } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, wsOptions);
  const inbox = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const w = waiters.shift();
    if (w) w.resolve(msg);
    else inbox.push(msg);
  });
  ws.on('error', () => {});
  ws.opened = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('unexpected-response', (_, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', reject);
  });
  ws.closed = new Promise((resolve) =>
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  ws.next = (ms = 2000) => {
    if (inbox.length) return Promise.resolve(inbox.shift());
    return new Promise((resolve, reject) => {
      const w = { resolve };
      const t = setTimeout(() => {
        waiters.splice(waiters.indexOf(w), 1);
        reject(new Error('no message within ' + ms + ' ms'));
      }, ms);
      w.resolve = (m) => {
        clearTimeout(t);
        resolve(m);
      };
      waiters.push(w);
    });
  };
  ws.drain = async (ms = 150) => {
    await delay(ms);
    return inbox.splice(0);
  };
  ws.json = (m) => ws.send(JSON.stringify(m));
  return ws;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Connects and joins; resolves after the relay's peer ack.
async function join(port, role, room, opts) {
  const ws = connect(port, opts);
  await ws.opened;
  ws.json({ t: 'join', role, room });
  ws.ack = await ws.next();
  return ws;
}

function getJson(port, path, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('pad relay', () => {
  let srv;
  before(async () => {
    srv = await startServer();
  });
  after(async () => {
    await srv.stop();
  });

  test('pad-info lists the pad page on the LAN addresses at the real port', async () => {
    const { res, body } = await getJson(srv.port, PAD_INFO_PATH, 'GET', {
      host: `mybox.local:${srv.port}`,
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.headers['cache-control'], 'no-store');
    const { urls } = JSON.parse(body);
    assert.deepEqual(urls, [
      `http://192.168.1.20:${srv.port}/pad.html`,
      `http://172.17.0.1:${srv.port}/pad.html`,
      `http://mybox.local:${srv.port}/pad.html`,
    ]);
    const q = await getJson(srv.port, `${PAD_INFO_PATH}?x=1`);
    assert.equal(q.res.statusCode, 200, 'query strings are fine');
    const post = await getJson(srv.port, PAD_INFO_PATH, 'POST');
    assert.equal(post.res.statusCode, 405);
    const other = await getJson(srv.port, '/pad-info-not');
    assert.equal(other.res.statusCode, 404, 'other paths are passed on');
  });

  test('join: peer notices to both sides, room cleaned up when empty', async () => {
    const game = await join(srv.port, 'game', 'ABCD');
    assert.deepEqual(game.ack, { t: 'peer', connected: false });
    assert.equal(srv.relay.stats().rooms, 1);
    const pad = await join(srv.port, 'pad', 'ABCD');
    assert.deepEqual(pad.ack, { t: 'peer', connected: true });
    assert.deepEqual(await game.next(), { t: 'peer', connected: true });
    assert.deepEqual(srv.relay.stats(), { rooms: 1, clients: 2, joined: 2 });

    pad.close();
    assert.deepEqual(await game.next(), { t: 'peer', connected: false });
    const pad2 = await join(srv.port, 'pad', 'ABCD');
    assert.deepEqual(pad2.ack, { t: 'peer', connected: true });
    assert.deepEqual(await game.next(), { t: 'peer', connected: true });

    game.close();
    assert.deepEqual(await pad2.next(), { t: 'peer', connected: false });
    pad2.close();
    await pad2.closed;
    await delay(50);
    assert.deepEqual(srv.relay.stats(), { rooms: 0, clients: 0, joined: 0 });
  });

  test('forwards validated inputs pad -> game and rumble/hello game -> pad', async () => {
    const game = await join(srv.port, 'game', 'FWDX');
    const pad = await join(srv.port, 'pad', 'FWDX');
    await game.next(); // peer connected

    pad.json(encodeInput({ stickX: 0.5, stickY: -0.25, A: true, CR: true }));
    assert.deepEqual(await game.next(), { t: 'input', s: [0.5, -0.25, 1 | (1 << 8)] });

    // Re-encoded: stick clamped to the unit circle, unknown bits and fields stripped.
    pad.json({ t: 'input', s: [3, 4, 0xffff], evil: '<script>' });
    assert.deepEqual(await game.next(), { t: 'input', s: [0.6, 0.8, 0x1ff] });

    // Junk from the pad is dropped (and does not close it).
    pad.send('not json');
    pad.send(Buffer.from([1, 2, 3]));
    pad.json({ t: 'input', s: ['x', 0, 0] });
    pad.json({ t: 'input', s: [0, 0] });
    pad.json({ t: 'rumble', ms: 100 });
    pad.json({ t: 'hello', name: 'x' });
    pad.json({ t: 'join', role: 'game', room: 'ZZZZ' });
    assert.deepEqual(await game.drain(), []);
    assert.equal(pad.readyState, WebSocket.OPEN);

    game.json({ t: 'rumble', ms: 120 });
    assert.deepEqual(await pad.next(), { t: 'rumble', ms: 120 });
    game.json({ t: 'rumble', ms: 99999, extra: 1 });
    assert.deepEqual(await pad.next(), { t: 'rumble', ms: RELAY_LIMITS.maxRumbleMs });
    game.json({ t: 'hello', name: 'Castle\u0007 Grounds' + 'x'.repeat(100) });
    const hello = await pad.next();
    assert.equal(hello.t, 'hello');
    assert.equal(hello.name.length, RELAY_LIMITS.maxNameLength);
    assert.ok(hello.name.startsWith('Castle Grounds'));

    game.json({ t: 'rumble', ms: 'lots' });
    game.json({ t: 'input', s: [0, 0, 1] });
    game.json({ t: 'peer', connected: false });
    assert.deepEqual(await pad.drain(), []);

    pad.close();
    game.close();
    await Promise.all([pad.closed, game.closed]);
  });

  test('rooms are isolated', async () => {
    const gameA = await join(srv.port, 'game', 'AAAA');
    const gameB = await join(srv.port, 'game', 'BBBB');
    const padB = await join(srv.port, 'pad', 'BBBB');
    assert.equal(padB.ack.connected, true);
    await gameB.next();
    padB.json(encodeInput({ B: true }));
    assert.deepEqual(await gameB.next(), { t: 'input', s: [0, 0, 2] });
    assert.deepEqual(await gameA.drain(), []);
    for (const ws of [gameA, gameB, padB]) ws.close();
  });

  test('a new pad (or game) replaces the old one, which is closed with 4000', async () => {
    const game = await join(srv.port, 'game', 'REPL');
    const pad1 = await join(srv.port, 'pad', 'REPL');
    await game.next();
    const pad2 = await join(srv.port, 'pad', 'REPL');
    assert.deepEqual(pad2.ack, { t: 'peer', connected: true });
    assert.equal((await pad1.closed).code, CLOSE_CODES.REPLACED);
    // The game hears about the new pad, never that the seat emptied.
    assert.deepEqual(await game.next(), { t: 'peer', connected: true });
    assert.deepEqual(await game.drain(), []);
    pad2.json(encodeInput({ Z: true }));
    assert.deepEqual(await game.next(), { t: 'input', s: [0, 0, 4] });

    const game2 = await join(srv.port, 'game', 'REPL');
    assert.deepEqual(game2.ack, { t: 'peer', connected: true });
    assert.equal((await game.closed).code, CLOSE_CODES.REPLACED);
    assert.deepEqual(await pad2.next(), { t: 'peer', connected: true });
    game2.json({ t: 'hello', name: 'Pip' });
    assert.deepEqual(await pad2.next(), { t: 'hello', name: 'Pip' });
    assert.deepEqual(srv.relay.stats().joined >= 2, true);
    pad2.close();
    game2.close();
    await Promise.all([pad2.closed, game2.closed]);
  });

  test('the first message must be a valid join', async () => {
    const bad = [
      { t: 'input', s: [0, 0, 0] },
      { t: 'join', role: 'pad', room: 'abcd' },
      { t: 'join', role: 'pad', room: 'ABCDE' },
      { t: 'join', role: 'boss', room: 'ABCD' },
      { t: 'join', role: 'game' },
      'hello',
    ];
    for (const m of bad) {
      const ws = connect(srv.port);
      await ws.opened;
      ws.send(typeof m === 'string' ? m : JSON.stringify(m));
      assert.equal((await ws.closed).code, CLOSE_CODES.BAD_JOIN, JSON.stringify(m));
    }
    await delay(20);
    assert.equal(srv.relay.stats().rooms, 0);
  });

  test('messages over 1 KB close the socket', async () => {
    const game = await join(srv.port, 'game', 'BIGM');
    const pad = await join(srv.port, 'pad', 'BIGM');
    await game.next();
    pad.json({ t: 'input', s: [0, 0, 0], pad: 'x'.repeat(2000) });
    assert.equal((await pad.closed).code, CLOSE_CODES.TOO_BIG);
    assert.deepEqual(await game.next(), { t: 'peer', connected: false });
    game.close();
  });

  test('bursts are rate limited, the latest input still arrives; floods are cut off', async () => {
    const game = await join(srv.port, 'game', 'RATE');
    const pad = await join(srv.port, 'pad', 'RATE');
    await game.next();
    const n = 150; // over the per-second budget, under the flood cut-off
    for (let i = 1; i <= n; i++) pad.json(encodeInput({ stickX: i / 1000 }));
    const got = await game.drain(400);
    assert.ok(got.length <= RELAY_LIMITS.maxMsgsPerSec + 15, `forwarded ${got.length}`);
    assert.ok(got.length >= RELAY_LIMITS.maxMsgsPerSec, `forwarded ${got.length}`);
    assert.deepEqual(got.at(-1), { t: 'input', s: [n / 1000, 0, 0] }, 'latest state delivered');
    const xs = got.map((m) => m.s[0]);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'in order');
    assert.equal(pad.readyState, WebSocket.OPEN);

    await delay(1000); // new window
    for (let i = 0; i < RELAY_LIMITS.maxMsgsPerSec * RELAY_LIMITS.floodFactor + 10; i++) {
      pad.json(encodeInput({ A: i % 2 === 0 }));
    }
    assert.equal((await pad.closed).code, CLOSE_CODES.FLOOD);
    game.close();
    await game.closed;
  });
});

describe('pad relay limits and liveness', () => {
  test('room limit: joins that would open another room are refused', async () => {
    const srv = await startServer({ maxRooms: 2 });
    try {
      const a = await join(srv.port, 'game', 'AAAA');
      const b = await join(srv.port, 'game', 'BBBB');
      const c = connect(srv.port);
      await c.opened;
      c.json({ t: 'join', role: 'game', room: 'CCCC' });
      assert.equal((await c.closed).code, CLOSE_CODES.FULL);
      // Joining an existing room still works; a freed room makes space again.
      const padA = await join(srv.port, 'pad', 'AAAA');
      assert.equal(padA.ack.connected, true);
      b.close();
      await b.closed;
      await delay(30);
      const c2 = await join(srv.port, 'game', 'CCCC');
      assert.deepEqual(c2.ack, { t: 'peer', connected: false });
      for (const ws of [a, padA, c2]) ws.close();
    } finally {
      await srv.stop();
    }
  });

  test('socket limit: extra connections are refused with 503', async () => {
    const srv = await startServer({ maxClients: 2 });
    try {
      const a = connect(srv.port);
      const b = connect(srv.port);
      await Promise.all([a.opened, b.opened]);
      const c = connect(srv.port);
      await assert.rejects(c.opened, /503/);
      a.close();
      b.close();
    } finally {
      await srv.stop();
    }
  });

  test('sockets that never join are closed', async () => {
    const srv = await startServer({ joinTimeoutMs: 80 });
    try {
      const ws = connect(srv.port);
      await ws.opened;
      assert.equal((await ws.closed).code, CLOSE_CODES.JOIN_TIMEOUT);
    } finally {
      await srv.stop();
    }
  });

  test('heartbeat drops a dead socket and tells its peer', async () => {
    const srv = await startServer({ heartbeatMs: 60 });
    try {
      const game = await join(srv.port, 'game', 'BEAT');
      const deadPad = await join(srv.port, 'pad', 'BEAT', { autoPong: false });
      assert.deepEqual(await game.next(), { t: 'peer', connected: true });
      assert.deepEqual(await game.next(), { t: 'peer', connected: false });
      await deadPad.closed;
      await delay(200); // several more beats: the live game socket stays
      assert.equal(game.readyState, WebSocket.OPEN);
      assert.deepEqual(srv.relay.stats(), { rooms: 1, clients: 1, joined: 1 });
      game.close();
    } finally {
      await srv.stop();
    }
  });

  test('cross-site pages cannot connect; same-origin pages can', async () => {
    const srv = await startServer();
    try {
      const evil = connect(srv.port, { origin: 'http://evil.example' });
      await assert.rejects(evil.opened, /403/);
      const ok = connect(srv.port, { origin: `http://127.0.0.1:${srv.port}` });
      await ok.opened;
      ok.close();
    } finally {
      await srv.stop();
    }
  });

  test('other upgrade paths are left to their own handlers', async () => {
    const srv = await startServer();
    const other = new WebSocketServer({ noServer: true });
    srv.server.on('upgrade', (req, socket, head) => {
      if (req.url === '/other') {
        other.handleUpgrade(req, socket, head, (ws) => ws.send(JSON.stringify({ t: 'other' })));
      }
    });
    try {
      const ws = connect(srv.port, { path: '/other' });
      assert.deepEqual(await ws.next(), { t: 'other' });
      ws.close();
    } finally {
      other.close();
      await srv.stop();
    }
  });

  test('closing the http server closes the relay sockets', async () => {
    const srv = await startServer();
    const game = await join(srv.port, 'game', 'SHUT');
    await srv.stop();
    const { code } = await game.closed;
    assert.ok(code === CLOSE_CODES.SHUTDOWN || code === 1006, `code ${code}`);
    assert.deepEqual(srv.relay.stats(), { rooms: 0, clients: 0, joined: 0 });
  });
});

describe('pad page urls', () => {
  test('LAN addresses first, virtual/VPN/link-local last, IPv6 and loopback skipped', () => {
    const urls = padPageUrls({
      interfaces: {
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        'vEthernet (WSL)': [{ address: '172.28.0.1', family: 'IPv4', internal: false }],
        tailscale0: [{ address: '100.101.1.2', family: 'IPv4', internal: false }],
        en7: [{ address: '169.254.3.4', family: 'IPv4', internal: false }],
        eth0: [{ address: '10.0.0.5', family: 4, internal: false }],
        wlan0: [
          { address: '192.168.0.9', family: 'IPv4', internal: false },
          { address: 'fe80::1', family: 'IPv6', internal: false },
        ],
      },
      port: 4173,
      host: '192.168.0.9:4173',
    });
    assert.deepEqual(urls, [
      'http://192.168.0.9:4173/pad.html',
      'http://10.0.0.5:4173/pad.html',
      'http://172.28.0.1:4173/pad.html',
      'http://100.101.1.2:4173/pad.html',
      'http://169.254.3.4:4173/pad.html',
    ]);
  });

  test('host header fallback (sanitised) and no interfaces', () => {
    assert.deepEqual(padPageUrls({ interfaces: {}, port: 5173, host: 'localhost:5173' }), [
      'http://localhost:5173/pad.html',
    ]);
    assert.deepEqual(padPageUrls({ interfaces: {}, port: 5173, host: 'a b/"<x>' }), []);
    assert.deepEqual(padPageUrls({ interfaces: null, port: 5173 }), []);
  });
});

describe('vite integration', () => {
  test('the plugin registers for dev and preview, and skips middleware mode', () => {
    const plugin = padRelay();
    assert.equal(plugin.name, 'pad-relay');
    assert.equal(typeof plugin.configureServer, 'function');
    assert.equal(typeof plugin.configurePreviewServer, 'function');
    const used = [];
    plugin.configureServer({ httpServer: null, middlewares: { use: (f) => used.push(f) } });
    assert.equal(used.length, 0);
    const server = http.createServer();
    plugin.configurePreviewServer({ httpServer: server, middlewares: { use: (f) => used.push(f) } });
    assert.equal(used.length, 1);
    assert.equal(server.listenerCount('upgrade'), 1);
    server.emit('close');
    assert.equal(server.listenerCount('upgrade'), 0);
  });

  test('vite.config.js: relay plugin, LAN hosts, pad page in the build when present', async () => {
    const { default: config } = await import('../vite.config.js');
    assert.ok(config.plugins.some((p) => p && p.name === 'pad-relay'));
    assert.equal(config.server.host, true);
    assert.equal(config.preview.host, true);
    const input = config.build.rolldownOptions.input;
    assert.equal(input.main, 'index.html');
    const { existsSync } = await import('node:fs');
    const hasPad = existsSync(new URL('../pad.html', import.meta.url));
    assert.equal(input.pad, hasPad ? 'pad.html' : undefined);
  });

  test('on a real Vite dev server: pad-info, relay and HMR websocket side by side', async (t) => {
    const { createServer } = await import('vite');
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pad-relay-'));
    await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>t</title>');
    const vite = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [padRelay({ networkInterfaces: () => FAKE_IFS })],
      server: { port: 0, host: '127.0.0.1', strictPort: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    t.after(async () => {
      await vite.close();
      await fs.rm(root, { recursive: true, force: true });
    });
    await vite.listen();
    const { port } = vite.httpServer.address();

    const info = await getJson(port, PAD_INFO_PATH, 'GET', { accept: 'text/html' });
    assert.equal(info.res.statusCode, 200);
    assert.equal(JSON.parse(info.body).urls[0], `http://192.168.1.20:${port}/pad.html`);

    const game = await join(port, 'game', 'VITE');
    const pad = await join(port, 'pad', 'VITE');
    assert.deepEqual(await game.next(), { t: 'peer', connected: true });
    pad.json(encodeInput({ START: true }));
    assert.deepEqual(await game.next(), { t: 'input', s: [0, 0, 16] });

    // Vite's own HMR socket still connects (it answers with a 'connected' message).
    const hmr = new WebSocket(`ws://127.0.0.1:${port}/`, 'vite-hmr');
    const first = await new Promise((resolve, reject) => {
      hmr.once('message', (d) => resolve(JSON.parse(d.toString())));
      hmr.once('error', reject);
    });
    assert.equal(first.type, 'connected');
    for (const ws of [hmr, game, pad]) ws.close();
  });
});
