// The phone's controller page (pad.html) in a real browser against the real relay (the dev
// server's tools/padRelay.js plugin) with a stand-in game on a `ws` socket: the page joins,
// touches reach the game, rumble reaches the phone, the layout fills the screen in both
// orientations, the code screen works, another phone can take over and this one rejoin, and
// on the computer's LAN address (the phone's real case: not a secure page, no wake lock API)
// the page keeps the screen on with its video. Opt-in: E2E=1 (Vite + headless Chromium, ~30 s).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
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
  // No proxy (the LAN address below must be reached directly; Chromium would still send its
  // WebSockets through a proxy named in the environment).
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k)));
  browser = await chromium.launch({ env, args: ['--no-proxy-server'] });
}, { timeout: 120000 });

// This machine's first LAN address (what the game's QR code points the phone at).
const lan = Object.values(os.networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;

after(async () => {
  await browser?.close();
  await server?.close();
});

// A stand-in game in room `room`: records what arrives, can send rumble / hello.
async function fakeGame(room, origin = base) {
  const ws = new WebSocket(origin.replace(/^http/, 'ws') + PAD_WS_PATH);
  const got = [];
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'join', role: 'game', room }));
  const inputs = () => got.filter((m) => m.t === 'input').map(decodeInput);
  return { ws, got, inputs, send: (m) => ws.send(JSON.stringify(m)) };
}

async function phonePage(width, height, url, { origin = base, init } = {}) {
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
  if (init) await page.addInitScript(init);
  await page.goto(origin + url, { waitUntil: 'load', timeout: 120000 });
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
    await until(() => page.evaluate(() => document.querySelector('.pad-strip-text').textContent === 'Game HJKM not found yet'));
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

test('another phone takes over: this one says so in full, greys its controls, and rejoins with a tap', { skip, timeout: 120000 }, async () => {
  const game = await fakeGame('WMWM');
  const a = await phonePage(360, 740, '/pad.html?room=WMWM');
  let b;
  try {
    await until(() => a.page.evaluate(() => window.__pad.link.status === 'connected'));
    b = await phonePage(390, 844, '/pad.html?room=WMWM');
    await until(() => a.page.evaluate(() => window.__pad.link.status === 'replaced'));
    const seen = await a.page.evaluate(() => {
      const t = document.querySelector('.pad-strip-text');
      const plate = document.querySelector('.pad-plate');
      return {
        text: t.textContent,
        fits: t.scrollWidth <= t.clientWidth,
        plate: getComputedStyle(plate).display,
        cap: plate.querySelector('.pad-plate-cap').textContent,
        rejoin: getComputedStyle(plate.querySelector('.pad-plate-rejoin')).display,
        grey: getComputedStyle(document.querySelector('.cg-pad .cg-tc-btn.cg-tc-A')).filter,
      };
    });
    assert.equal(seen.text, 'Taken over · tap to rejoin');
    assert.ok(seen.fits, 'the whole text shows');
    assert.equal(seen.plate, 'flex');
    assert.equal(seen.cap, 'TAKEN OVER');
    assert.equal(seen.rejoin, 'flex');
    assert.match(seen.grey, /saturate/, 'the controls look off');
    // The plate is the big rejoin button; the other phone is now the one taken over.
    await a.page.tap('.pad-plate');
    await until(() => a.page.evaluate(() => window.__pad.link.status === 'connected'));
    await until(() => b.page.evaluate(() => window.__pad.link.status === 'replaced'));
    await until(() => a.page.evaluate(() => getComputedStyle(document.querySelector('.cg-pad .cg-tc-btn.cg-tc-A')).filter === 'none'));
    // In landscape (no plate) the strip text rejoins.
    await b.page.setViewportSize({ width: 844, height: 390 });
    await b.page.waitForFunction(() => window.__pad.tc.layout.mode === 'landscape');
    await b.page.tap('.pad-strip-text');
    await until(() => b.page.evaluate(() => window.__pad.link.status === 'connected'));
    // Every status text fits the strip of a small phone, in both orientations.
    for (const [w, h] of [[320, 568], [568, 320]]) {
      await a.page.setViewportSize({ width: w, height: h });
      await a.page.waitForFunction((mode) => window.__pad.tc.layout.mode === mode, w > h ? 'landscape' : 'portrait');
      const cut = await a.page.evaluate(async () => {
        const { statusView } = await import('/src/pad/statusStrip.js');
        const t = document.querySelector('.pad-strip-text');
        const bad = [];
        for (const s of ['connecting', 'waiting', 'connected', 'reconnecting', 'replaced', 'stopped']) {
          window.__pad.strip.set(s, { room: 'WMWM', failures: 5 });
          if (t.scrollWidth > t.clientWidth) bad.push(`${statusView(s, { room: 'WMWM', failures: 5 }).text} ${t.scrollWidth}>${t.clientWidth}`);
        }
        return bad;
      });
      assert.deepEqual(cut, [], `${w}x${h}`);
    }
    assert.deepEqual([...a.errors, ...b.errors], []);
  } finally {
    game.ws.close();
    await a.context.close();
    await b?.context.close();
  }
});

test('on the LAN address (not a secure page, no wake lock API): joins, and a playing video keeps the screen on', { skip: skip || (!lan && 'no LAN address on this machine'), timeout: 120000 }, async () => {
  // The phone's real case: the dev server on every interface, the page at http://<LAN address>.
  const { createServer } = await import('vite');
  const lanServer = await createServer({ root, logLevel: 'error', server: { port: 0, host: lan, hmr: false } });
  await lanServer.listen();
  const origin = `http://${lan}:${lanServer.httpServer.address().port}`;
  const game = await fakeGame('LNPQ', origin);
  const pages = [];
  try {
    // What Chromium itself asks of a video before it keeps the screen on (VideoWakeLock):
    // playing, with video frames, at least 75 % of it in view; stream videos may be small.
    const awakeState = (page) =>
      page.evaluate(async () => {
        const v = document.querySelector('video.pad-awake');
        const ratio = await new Promise((r) => {
          const io = new IntersectionObserver((e) => (io.disconnect(), r(e.at(-1).intersectionRatio)));
          io.observe(v);
        });
        return {
          secure: isSecureContext,
          api: 'wakeLock' in navigator,
          mode: window.__pad.awake.mode,
          held: window.__pad.awake.held(),
          paused: v.paused,
          muted: v.muted,
          ready: v.readyState,
          time: v.currentTime,
          frames: v.videoWidth,
          kinds: v.srcObject.getTracks().map((t) => `${t.kind}:${t.readyState}`).sort(),
          ratio,
        };
      });

    const chromium = await phonePage(390, 844, '/pad.html?room=lnpq', { origin });
    pages.push(chromium);
    await until(() => chromium.page.evaluate(() => window.__pad.link?.status === 'connected'));
    let st = await awakeState(chromium.page);
    assert.equal(st.secure, false);
    assert.equal(st.api, false, 'no wake lock API on a plain http page');
    assert.equal(st.mode, 'video');
    await until(async () => (await awakeState(chromium.page)).time > 0.5);
    st = await awakeState(chromium.page);
    assert.equal(st.held, true, 'muted: playing without a tap');
    assert.equal(st.paused, false);
    assert.equal(st.muted, true);
    assert.ok(st.ready >= 2 && st.frames > 0, 'frames arrive');
    assert.deepEqual(st.kinds, ['video:live']);
    assert.ok(st.ratio > 0.75, `in view (${st.ratio})`);

    // WebKit's rule (the iPhone), in this browser: a video with sound, started by a tap.
    const webkit = await phonePage(390, 844, '/pad.html?room=LNPQ', {
      origin,
      init: () => {
        HTMLVideoElement.prototype.webkitSetPresentationMode = function () {};
      },
    });
    pages.push(webkit);
    st = await awakeState(webkit.page);
    assert.equal(st.muted, false);
    assert.deepEqual(st.kinds, ['audio:live', 'video:live']);
    assert.equal(st.held, false, 'sound needs a tap first');
    await webkit.touch('touchStart', [[195, 400, 1]]);
    await webkit.touch('touchEnd', []);
    await until(async () => (await awakeState(webkit.page)).held);
    await until(async () => (await awakeState(webkit.page)).time > 0.5);
    assert.deepEqual([...chromium.errors, ...webkit.errors], []);
  } finally {
    game.ws.close();
    for (const p of pages) await p.context.close();
    await lanServer.close();
  }
});
