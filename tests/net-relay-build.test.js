// The production build and `vite preview` with the phone controller (vite.config.js,
// tools/padRelay.js): the game stays one self-contained bundle and pad.html is built on its
// own next to it; the preview server carries the relay (marker, pad-info, WebSocket) and
// offers the pad page only at addresses a phone can reach.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { PAD_WS_PATH, PAD_INFO_PATH, encodeInput } from '../src/net/protocol.js';
import { hasRelayMarker } from '../src/net/RemotePad.js';
import { isLoopbackHost } from '../tools/padRelay.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let outDir;

before(async () => {
  const { build } = await import('vite');
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'castle-build-'));
  await build({ root, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
}, { timeout: 120000 });

after(async () => {
  if (outDir) await fs.rm(outDir, { recursive: true, force: true });
});

const read = (f) => fs.readFile(path.join(outDir, f), 'utf8');
const scripts = (html) => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
const preloads = (html) => [...html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*>/g)];
// Static and dynamic imports of other built files ("./x.js" or "/assets/x.js").
const chunkImports = (js) => [...js.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{0,2}\/[^"']+\.js)["']/g)].map((m) => m[1]);

test('the game is one bundle; pad.html has its own', async () => {
  const assets = (await fs.readdir(path.join(outDir, 'assets'))).sort();
  const js = assets.filter((f) => f.endsWith('.js'));
  assert.deepEqual(
    js.map((f) => f.replace(/-[\w-]{8}\.js$/, '')).sort(),
    ['logoWorker', 'main', 'pad'],
    `built scripts: ${js.join(', ')}`,
  );

  const index = await read('index.html');
  assert.deepEqual(scripts(index).map((s) => s.replace(/-[\w-]{8}\.js$/, '')), ['./assets/main']);
  assert.equal(preloads(index).length, 0, 'the game preloads nothing else');
  const pad = await read('pad.html');
  assert.deepEqual(scripts(pad).map((s) => s.replace(/-[\w-]{8}\.js$/, '')), ['./assets/pad']);
  assert.equal(preloads(pad).length, 0);

  const main = await read(`assets/${js.find((f) => f.startsWith('main-'))}`);
  const padJs = await read(`assets/${js.find((f) => f.startsWith('pad-'))}`);
  assert.deepEqual(chunkImports(main), [], 'the game imports no other chunk');
  assert.deepEqual(chunkImports(padJs), [], 'the pad imports no other chunk');
  assert.ok(padJs.length < 200 * 1024, `the pad stays small (${padJs.length} bytes)`);
  assert.ok(!padJs.includes('WebGLRenderer'), 'no three.js on the phone');
});

function get(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function startPreview(host) {
  const { preview } = await import('vite');
  const server = await preview({
    root,
    logLevel: 'silent',
    build: { outDir },
    preview: { port: 0, host, strictPort: false, open: false },
  });
  return { server, port: server.httpServer.address().port };
}

test('vite preview on 127.0.0.1: relay marker, pad page, relay, no unreachable QR target', async (t) => {
  const { server, port } = await startPreview('127.0.0.1');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;

  const head = await get(`${base}/`, 'HEAD');
  assert.equal(head.res.statusCode, 200);
  assert.ok(hasRelayMarker(head.res.headers['server-timing']), 'the game finds the relay');
  const padPage = await get(`${base}/pad.html?room=ABCD`);
  assert.equal(padPage.res.statusCode, 200);
  assert.match(padPage.body, /assets\/pad-[\w-]+\.js/);

  const info = await get(`${base}${PAD_INFO_PATH}`);
  assert.equal(info.res.statusCode, 200);
  assert.equal(info.res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(info.body), { urls: [], reason: 'loopback' });

  // The relay itself works on the preview server.
  const open = (role) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${PAD_WS_PATH}`);
      ws.inbox = [];
      ws.on('message', (d) => ws.inbox.push(JSON.parse(d.toString())));
      ws.on('error', reject);
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'join', role, room: 'PREV' }));
        resolve(ws);
      });
    });
  const game = await open('game');
  const pad = await open('pad');
  pad.send(JSON.stringify(encodeInput({ A: true })));
  const end = Date.now() + 3000;
  while (!game.inbox.some((m) => m.t === 'input') && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(game.inbox.find((m) => m.t === 'input'), { t: 'input', s: [0, 0, 1] });
  game.close();
  pad.close();
});

test('vite preview on every interface: the offered pad page URLs answer', async (t) => {
  const { server, port } = await startPreview(true);
  t.after(() => server.close());
  const info = JSON.parse((await get(`http://127.0.0.1:${port}${PAD_INFO_PATH}`)).body);
  if (!info.urls.length) {
    assert.equal(info.reason, 'no-network');
    t.skip('no network address on this machine');
    return;
  }
  for (const u of info.urls) assert.equal(isLoopbackHost(new URL(u).hostname), false, u);
  const first = await get(`${info.urls[0]}?room=ABCD`);
  assert.equal(first.res.statusCode, 200, info.urls[0]);
  assert.match(first.body, /assets\/pad-[\w-]+\.js/);
});
