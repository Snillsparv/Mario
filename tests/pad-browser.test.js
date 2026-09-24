// The phone's controller page (pad.html) in a real browser against the real relay (the dev
// server's tools/padRelay.js plugin) with a stand-in game on a `ws` socket: the page joins,
// touches reach the game, rumble reaches the phone, the layout fills the screen in both
// orientations, and the code screen works. Opt-in: E2E=1 (Vite + headless Chromium, ~20 s).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { decodeInput, PAD_WS_PATH } from '../src/net/protocol.js';

const skip = !process.env.E2E && 'browser test: set E2E=1 to run';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let browser;
let base;

before(async () => {
  if (skip) return;
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
  await server.listen();
  base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch();
}, { timeout: 120000 });

after(async () => {
  await browser?.close();
  await server?.close();
});

// A stand-in game in room `room`: records what arrives, can send rumble / hello.
async function fakeGame(room) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + PAD_WS_PATH);
  const got = [];
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'join', role: 'game', room }));
  const inputs = () => got.filter((m) => m.t === 'input').map(decodeInput);
  return { ws, got, inputs, send: (m) => ws.send(JSON.stringify(m)) };
}

async function phonePage(width, height, url) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => requests.push(r.url()));
  await page.addInitScript(() => {
    window.__vib = [];
    Object.defineProperty(navigator, 'vibrate', { value: (ms) => (window.__vib.push(ms), true), configurable: true });
  });
  await page.goto(base + url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
  return { context, page, errors, requests, touch };
}

const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

test('pad.html?room=: full-screen controller, touches reach the game, rumble reaches the phone', { skip, timeout: 180000 }, async () => {
  const game = await fakeGame('HJKM');
  const { context, page, errors, requests, touch } = await phonePage(390, 844, '/pad.html?room=hjkm');
  try {
    await until(() => page.evaluate(() => document.querySelector('.pad-strip-text')?.textContent === 'Connected to game HJKM'));
    const info = await page.evaluate(() => {
      const L = window.__pad.tc.layout;
      const body = document.querySelector('.cg-pad .cg-tc-body').getBoundingClientRect();
      const strip = document.querySelector('.pad-strip').getBoundingClientRect();
      return { L, body: [body.width, body.height], strip: [strip.x, strip.y, strip.width, strip.height], url: location.search, plate: document.querySelector('.pad-plate-code').textContent };
    });
    assert.equal(info.url, '?room=HJKM', 'the code is normalised in the URL');
    assert.equal(info.L.standalone, true);
    assert.equal(info.L.mode, 'portrait');
    assert.deepEqual(info.body, [390, 844], 'the controller body fills the screen');
    assert.deepEqual(info.strip.map(Math.round), [info.L.strip.x, info.L.strip.y, info.L.strip.w, info.L.strip.h].map(Math.round));
    assert.equal(info.plate, 'HJKM');
    assert.ok(!requests.some((u) => /three|\/src\/main\.js|\/src\/(world|player|render|audio|objects)\//.test(u)), 'no game code or three.js loaded');

    // Stick up and JUMP with two fingers; the game sees both, then the release.
    const { stick, buttons } = info.L;
    await touch('touchStart', [[stick.x, stick.y, 1]]);
    await touch('touchMove', [[stick.x, stick.y - stick.travel, 1]]);
    await touch('touchStart', [[stick.x, stick.y - stick.travel, 1], [buttons.A.x, buttons.A.y, 2]]);
    await until(() => game.inputs().some((s) => s.A && s.stickY === 1));
    await touch('touchEnd', [[stick.x, stick.y - stick.travel, 1]]);
    await touch('touchEnd', []);
    await until(() => {
      const s = game.inputs().at(-1);
      return s && !s.A && s.stickY === 0;
    });
    // A quick tap on CROUCH: pressed and released, both delivered.
    const n = game.inputs().length;
    await touch('touchStart', [[buttons.Z.x, buttons.Z.y, 3]]);
    await touch('touchEnd', []);
    await until(() => game.inputs().slice(n).some((s) => s.Z) && !game.inputs().at(-1).Z);

    // Rumble: vibration (after the taps above) and the LED flash.
    game.send({ t: 'rumble', ms: 160 });
    await until(() => page.evaluate(() => window.__vib.includes(160)));
    assert.equal(await page.evaluate(() => document.querySelector('.cg-pad').classList.contains('pad-hit')), true);
    // Heartbeat while idle.
    const before = game.got.length;
    await page.waitForTimeout(450);
    assert.ok(game.got.length - before >= 3, `heartbeats ${game.got.length - before}`);

    // The game goes away: waiting; the LED turns amber.
    game.ws.close();
    await until(() => page.evaluate(() => /not found, waiting/.test(document.querySelector('.pad-strip-text').textContent)));
    assert.equal(await page.evaluate(() => document.querySelector('.cg-pad').dataset.link), 'waiting');

    // Landscape: the wide layout, the strip moves to the top middle, touches still work.
    const game2 = await fakeGame('HJKM');
    await until(() => page.evaluate(() => window.__pad.link.status === 'connected'));
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => window.__pad.tc.layout.mode === 'landscape', null, { timeout: 10000 });
    const land = await page.evaluate(() => {
      const L = window.__pad.tc.layout;
      const strip = document.querySelector('.pad-strip').getBoundingClientRect();
      const plate = getComputedStyle(document.querySelector('.pad-plate')).display;
      return { L, strip: [strip.x, strip.width], plate };
    });
    assert.ok(Math.abs(land.strip[0] + land.strip[1] / 2 - 422) < 1, 'strip centred');
    assert.equal(land.plate, 'none', 'no plate in landscape');
    await touch('touchStart', [[land.L.buttons.CR.x, land.L.buttons.CR.y, 4]]);
    await until(() => game2.inputs().some((s) => s.CR));
    await touch('touchEnd', []);
    assert.deepEqual(errors, []);
    game2.ws.close();
  } finally {
    await context.close();
  }
});

test('pad.html without a code: letter keys, CONNECT, then the controller', { skip, timeout: 120000 }, async () => {
  const game = await fakeGame('KMPQ');
  const { context, page, errors } = await phonePage(390, 844, '/pad.html?room=IO12');
  try {
    assert.match(await page.textContent('.pad-code-msg'), /not a game code/);
    assert.equal(await page.isDisabled('.pad-code-go'), true);
    for (const k of ['K', 'M', 'P', 'Z', 'Backspace', 'Q']) await page.tap(`.pad-code-key[data-key="${k}"]`);
    assert.equal(await page.evaluate(() => window.__pad.entry.code), 'KMPQ');
    await page.tap('.pad-code-go');
    await until(() => page.evaluate(() => window.__pad.link?.status === 'connected'));
    assert.equal(await page.evaluate(() => location.search), '?room=KMPQ');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pad-code')).display), 'none');
    // Back to the code screen from the strip: the pad lets go of the game.
    await page.tap('.pad-strip-code');
    await until(() => game.got.some((m) => m.t === 'peer' && m.connected === false));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pad-code')).display), 'flex');
    assert.deepEqual(errors, []);
  } finally {
    game.ws.close();
    await context.close();
  }
});
