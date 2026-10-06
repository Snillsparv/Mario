// The production build and `vite preview` with the phone controller (vite.config.js,
// tools/padRelay.js): the game is one bundle (under its 1,700,000-byte budget) and two lazily
// loaded chunks, realLook (the realistic look's main-thread code) and laneBoss (Sparrow Lane's
// movers: the bins, STOMPWATT and the garage doors), each imported by the game only dynamically,
// importing only the game's bundle, no three.js of its own, under 90 KiB (laneBoss: 100 KiB, D1's
// garage doors: the chunk is "what moves in the dad's drive", prefetched at boot, never in the
// first frame's way; main is the scarce budget), beside
// its two module workers (the title logo's, and the realistic look's with the pure code main
// does not carry: no three.js, no chunk of its own, under 160 kB), and pad.html is built on
// its own next to it; the preview server carries the relay (marker, pad-info, WebSocket) and
// offers the pad page only at addresses a phone can reach; with E2E=1 the built bundle's
// (minified) shaders compile and draw every look in headless Chromium.
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
// Static and dynamic imports of other built files ("./x.js" or "/assets/x.js"; the minifier
// quotes a dynamic import's path in backticks).
const chunkImports = (js) => [...js.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'`](\.{0,2}\/[^"'`]+\.js)["'`]/g)].map((m) => m[1]);

test('the game is one bundle, its lazy realLook and laneBoss chunks (and its workers); pad.html has its own', async () => {
  const assets = (await fs.readdir(path.join(outDir, 'assets'))).sort();
  const js = assets.filter((f) => f.endsWith('.js'));
  assert.deepEqual(
    js.map((f) => f.replace(/-[\w-]{8}\.js$/, '')).sort(),
    ['laneBoss', 'laneRealWorker', 'logoWorker', 'main', 'pad', 'realLook'],
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
  // The realistic look's main-thread code: one chunk, imported by the game only dynamically (at
  // boot, beside the workers), importing nothing but the game's bundle.
  const lookFile = js.find((f) => f.startsWith('realLook-'));
  const look = await read(`assets/${lookFile}`);
  // ...and Sparrow Lane's movers (the bins: objects/laneBoss), the same way (at boot, attached
  // as the lane is built).
  const bossFile = js.find((f) => f.startsWith('laneBoss-'));
  const boss = await read(`assets/${bossFile}`);
  assert.deepEqual(chunkImports(main).sort(), [`./${bossFile}`, `./${lookFile}`].sort(), 'the game imports two chunks: realLook and laneBoss');
  const mainFile = js.find((f) => f.startsWith('main-'));
  // (Each chunk's cap: laneBoss's raised from 90 to 100 KiB for D1, the garage doors; see above.)
  const CAP = { realLook: 90 * 1024, laneBoss: 100 * 1024 };
  for (const [name, file, src] of [['realLook', lookFile, look], ['laneBoss', bossFile, boss]]) {
    assert.equal([...main.matchAll(new RegExp(`\\bimport\\s*\\(\\s*["'\`]\\./${name}-`, 'g'))].length, 1, `${name}: only dynamically (import())`);
    assert.ok(!new RegExp(`from\\s*["'\`]\\./${file.replace('.', '\\.')}`).test(main), `${name}: never statically`);
    assert.deepEqual([...new Set(chunkImports(src))], [`./${mainFile}`], `${name} imports only the game\'s bundle`);
    assert.ok(!src.includes('WebGLRenderer'), `no three.js in ${name}`);
    assert.ok(Buffer.byteLength(src) < CAP[name], `${name} stays small (${Buffer.byteLength(src)} bytes)`);
  }
  // (The store room's things, world/lane/garage.js ROOM, are the chunk's and the worker's: none
  // in the game's bundle.)
  assert.ok(!/\bshelves\b/.test(main) && /\bshelves\b/.test(boss), 'the store room\'s things only in the laneBoss chunk');
  assert.deepEqual(chunkImports(padJs), [], 'the pad imports no other chunk');
  assert.ok(Buffer.byteLength(main) < 1700000, `the game stays under its budget (${Buffer.byteLength(main)} bytes)`);
  // The realistic look's worker: started by the game (new Worker(new URL(...)), not an import).
  const worker = await read(`assets/${js.find((f) => f.startsWith('laneRealWorker-'))}`);
  assert.match(main, /laneRealWorker-[\w-]{8}\.js/, 'the game starts it');
  assert.deepEqual(chunkImports(worker), [], 'the worker imports no other chunk');
  assert.ok(!worker.includes('WebGLRenderer'), 'no three.js in the worker');
  assert.ok(Buffer.byteLength(worker) < 160 * 1024, `the worker stays small (${Buffer.byteLength(worker)} bytes)`);
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

// The built bundle's shaders (its /* glsl */ literals minified: tools/glslMinify.js) compile and
// draw: headless Chromium (SwiftShader) on `vite preview` of the build: the grounds, AI RACE
// (rain, fire, the beast, the storm's grade), the meltdown's burning sky, the retro filter, the
// hall, the skerries, Sparrow Lane's realistic look on the high tier (its post chain, F2 over it)
// and on the low one, and Pip's face screen; no console error, no program failing to link.
// Opt-in: E2E=1.
test('the built bundle\'s minified shaders compile and draw every look (E2E)', { skip: !process.env.E2E && 'browser test: set E2E=1 to run', timeout: 900000 }, async (t) => {
  const { server, port } = await startPreview('127.0.0.1');
  t.after(() => server.close());
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  t.after(() => browser.close());
  const visit = async (query, tour) => {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    try {
      await page.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: 'load', timeout: 180000 });
      await tour(page);
      const programs = await page.evaluate(() => {
        const r = window.__game.view.renderer;
        return { count: r.info.programs.length, failed: r.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).map((p) => p.name) };
      });
      t.diagnostic(`${query}: ${programs.count} programs`);
      assert.deepEqual(programs.failed, [], `${query}: programs that failed`);
      assert.deepEqual(errors, [], query);
    } finally {
      await page.close();
    }
  };
  const ready = (page) => page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const real = (page) => page.waitForFunction(() => window.__game.view.describeMode().startsWith('real'), null, { timeout: 300000, polling: 250 });
  await visit('?test=1&mute=1&tier=high', async (page) => {
    await ready(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.step(30);
      g.setDark(true);
      g.step(90);
      g.meltdown.skipTo(42);
      g.step(60);
      g.view.setN64Mode(!g.view.n64);
      g.step(5);
      g.view.setN64Mode(!g.view.n64);
      g.setDark(false);
      g.step(5);
      for (const area of ['hall', 'skerries', 'lane']) {
        g.enterArea(area);
        g.step(20);
      }
    });
    await real(page);
    const mode = await page.evaluate(() => {
      const g = window.__game;
      g.step(10);
      const mode = g.view.describeMode();
      g.view.toggleRetro();
      g.step(5);
      g.view.toggleRetro();
      g.step(2);
      return mode;
    });
    assert.match(mode, /^real \d+x\d+ msaa4 high\b/, 'the realistic look (through the meltdown\'s grade, still burning)');
  });
  await visit('?test=1&mute=1&area=lane&tier=low', async (page) => {
    await ready(page);
    await real(page);
    assert.match(await page.evaluate(() => (window.__game.step(10), window.__game.view.describeMode())), /^real \d+x\d+ direct low$/);
  });
  await visit('?face=1&mute=1', async (page) => {
    await page.waitForFunction(() => window.__game?.state.mode === 'face' && window.__game.face?.ready, null, { timeout: 120000 });
  });
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
