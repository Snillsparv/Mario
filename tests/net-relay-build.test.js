// The production build and `vite preview` with the phone controller (vite.config.js,
// tools/chunkPlan.js, tools/padRelay.js): the game is a tree of chunks: `main` (index.html's one
// script, under its byte budget) and its planned lazy chunks (CHUNKS below: each imported only by
// its parent, only dynamically, statically importing nothing but its ancestors, no three.js of
// its own, each under its cap), beside its two module workers (the title logo's, and the
// realistic look's with the pure code main does not carry: no three.js, no chunk of its own,
// under 160 kB); pad.html is built on its own next to it (no QR library: it never draws one);
// the preview server carries the relay (marker, pad-info, WebSocket) and offers the pad page only
// at addresses a phone can reach; with E2E=1 the built bundle's (minified) shaders compile and
// draw every look in headless Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
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

// The chunk plan: each lazy chunk, its parent (the chunk whose code imports it, only
// dynamically: src/core/chunks.js for main's; world/lane/index.js for the lane's children), its
// cap and the least it holds (an area's code in its chunk, not in main). Caps are tripwires with
// room to grow (about a fifth for the areas); raising one is the last resort, documented here,
// in vite.config.js and in docs/ARCHITECTURE.md ("Chunks").
const KiB = 1024;
const CHUNKS = {
  hall: { parent: 'main', cap: 60 * KiB, min: 30000 },
  skerries: { parent: 'main', cap: 88 * KiB, min: 40000 },
  lane: { parent: 'main', cap: 72 * KiB, min: 40000 },
  realLook: { parent: 'lane', cap: 90 * KiB, min: 30000 },
  // (110 KiB, from 100: what moves in the dad's drive, the bins, STOMPWATT and the garage doors,
  // now loaded through the lane's chunk; it was at 99.6 KiB.)
  laneBoss: { parent: 'lane', cap: 110 * KiB, min: 60000 },
  // The opt-in UI (about a quarter to grow): the face screen (?face=1), the phone panel with its
  // QR library (once a relay answers), the recorder (the first V or 9), the touch controller (a
  // touch screen).
  FaceScreen: { parent: 'main', cap: 35 * KiB, min: 15000 },
  PhonePanel: { parent: 'main', cap: 40 * KiB, min: 20000 },
  Recorder: { parent: 'main', cap: 15 * KiB, min: 8000 },
  TouchController: { parent: 'main', cap: 32 * KiB, min: 15000 },
};
// main's budget (vite.config.js MAIN_BUDGET): 1,700,000 while it was the one bundle; 1,560,000
// with the areas' code lazy (main 1,518,217); 1,465,000 with the opt-in UI lazy (1,424,826).
const MAIN_CAP = 1465000;

test('the game: main, its planned lazy chunks (each importing only its ancestors) and its workers; pad.html has its own', async (t) => {
  const assets = (await fs.readdir(path.join(outDir, 'assets'))).sort();
  const js = assets.filter((f) => f.endsWith('.js'));
  const base = (f) => f.replace(/-[\w-]{8}\.js$/, '');
  assert.deepEqual(js.map(base).sort(), [...Object.keys(CHUNKS), 'laneRealWorker', 'logoWorker', 'main', 'pad'].sort(), `built scripts: ${js.join(', ')}`);

  const index = await read('index.html');
  assert.deepEqual(scripts(index).map(base), ['./assets/main']);
  assert.equal(preloads(index).length, 0, 'the game preloads nothing else');
  const pad = await read('pad.html');
  assert.deepEqual(scripts(pad).map(base), ['./assets/pad']);
  assert.equal(preloads(pad).length, 0);

  const src = {};
  for (const f of js) src[base(f)] = await read(`assets/${f}`);
  const size = (name) => Buffer.byteLength(src[name]);
  const ancestors = (name) => (name === 'main' ? [] : [CHUNKS[name].parent, ...ancestors(CHUNKS[name].parent)]);
  const statics = (code) => [...new Set([...code.matchAll(/\bfrom\s*["'`]\.\/([^"'`]+\.js)["'`]/g)].map((m) => base(m[1])))];
  const dynamics = (code) => [...code.matchAll(/\bimport\s*\(\s*["'`]\.\/([^"'`]+\.js)["'`]/g)].map((m) => base(m[1]));
  for (const code of Object.values(src)) assert.deepEqual(chunkImports(code).filter((p) => !p.startsWith('./')), [], 'every chunk import is relative');
  assert.deepEqual(statics(src.main), [], 'the game imports nothing statically');
  for (const [name, { parent, cap, min }] of Object.entries(CHUNKS)) {
    const code = src[name];
    for (const dep of statics(code)) assert.ok(ancestors(name).includes(dep), `${name} imports only its ancestors (${dep})`);
    assert.ok(dynamics(src[parent]).includes(name), `${name}: imported by ${parent}, dynamically`);
    for (const other of Object.keys(src)) {
      if (other !== parent) assert.ok(!dynamics(src[other]).includes(name), `${name} only from ${parent} (not ${other})`);
      assert.ok(!statics(src[other]).includes(name) || CHUNKS[other] && ancestors(other).includes(name), `${name}: no sibling imports it`);
    }
    assert.ok(!code.includes('WebGLRenderer'), `no three.js in ${name}`);
    assert.ok(size(name) < cap, `${name} stays under its cap (${size(name)} of ${cap} bytes)`);
    assert.ok(size(name) > min, `${name} holds its code (${size(name)} bytes)`);
  }
  // (The store room's things, world/lane/garage.js ROOM, are the laneBoss chunk's and the
  // worker's: none in main or the lane's chunk.)
  assert.ok(!/\bshelves\b/.test(src.main) && !/\bshelves\b/.test(src.lane) && /\bshelves\b/.test(src.laneBoss), "the store room's things only in the laneBoss chunk");
  assert.ok(size('main') < MAIN_CAP, `the game stays under its budget (${size('main')} of ${MAIN_CAP} bytes)`);
  // (gzip -9 for the record, not asserted: it varies with the zlib version.)
  t.diagnostic(Object.keys(src).sort().map((n) => `${n} ${size(n)} (gzip ${gzipSync(src[n], { level: 9 }).length})`).join(', '));
  // The realistic look's worker: started by the game (new Worker(new URL(...)), not an import).
  assert.match(src.main, /laneRealWorker-[\w-]{8}\.js/, 'the game starts the worker');
  for (const w of ['laneRealWorker', 'logoWorker', 'pad']) {
    assert.deepEqual(chunkImports(src[w]), [], `${w} imports no other chunk`);
    assert.ok(!src[w].includes('WebGLRenderer'), `no three.js in ${w}`);
  }
  assert.ok(size('laneRealWorker') < 160 * KiB, `the worker stays small (${size('laneRealWorker')} bytes)`);
  assert.ok(size('pad') < 100 * KiB, `the pad stays small (${size('pad')} bytes)`);
  assert.ok(!/qrcode|addData/.test(src.pad), 'no QR code library on the phone');
  assert.ok(!/addData/.test(src.main) && /addData/.test(src.PhonePanel), "the QR code library only in the phone panel's chunk");
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
