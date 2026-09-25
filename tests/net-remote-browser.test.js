// The game side of the phone controller in the real game (Vite dev server with the relay
// plugin, headless Chromium) with a stand-in phone on a `ws` socket speaking the pad side of
// the protocol: the title's phone button and P open the panel (QR code, address, room code),
// Esc closes it without starting the game, a phone joining shows "connected" and closes the
// panel by itself, the phone's START starts the game, its stick moves Pip, Pip getting hurt
// rumbles the phone, the pause screen's P / phone B open and close the panel, and the phone
// leaving releases the controls. ?pad=0 (like a static host) keeps it all hidden.
// Opt-in: E2E=1 (Vite + headless Chromium, ~1 min).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { PAD_WS_PATH, PAD_INFO_PATH, encodeInput } from '../src/net/protocol.js';

const skip = !process.env.E2E && 'browser test: set E2E=1 to run';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let browser;
let base;

before(async () => {
  if (skip) return;
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  server = await createServer({ root, logLevel: 'error', server: { port: 0, host: true, hmr: false } }); // all interfaces, as npm run dev: a loopback-only relay offers no phone URL
  await server.listen();
  base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}, { timeout: 120000 });

after(async () => {
  await browser?.close();
  await server?.close();
});

const until = async (fn, ms = 15000, what = 'condition') => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 30));
  }
};

// A stand-in phone in `room`: joins as the pad, records what arrives, sends controller states
// (and keeps resending the last one every 100 ms, like the pad page).
async function fakePhone(room) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + PAD_WS_PATH);
  const got = [];
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r, j) => {
    ws.on('open', r);
    ws.on('error', j);
  });
  ws.send(JSON.stringify({ t: 'join', role: 'pad', room }));
  let state = {};
  const send = () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(encodeInput(state)));
  const beat = setInterval(send, 100);
  return {
    got,
    set(s) {
      state = s;
      send();
    },
    async tap(button) {
      this.set({ [button]: true });
      await new Promise((r) => setTimeout(r, 150));
      this.set({});
    },
    close() {
      clearInterval(beat);
      ws.close();
    },
  };
}

async function gamePage(query) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.goto(`${base}/${query}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('.cg-title canvas', { timeout: 180000 });
  return { page, errors, requests };
}

const panelState = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    return {
      open: g.phone.isOpen,
      joined: g.phone.joined,
      mode: g.state.mode,
      paused: g.state.paused,
      connected: g.remotePad.connected,
      room: g.remotePad.room,
      padUrl: g.remotePad.padUrl,
      shown: getComputedStyle(document.querySelector('.pp-panel')).display !== 'none',
    };
  });

test('title and pause: panel, pairing, phone START / stick / B, rumble, leaving', { skip, timeout: 300000 }, async () => {
  const { page, errors, requests } = await gamePage('?mute=1');
  let phone = null;
  try {
    await page.waitForFunction(() => window.__game?.remotePad?.status === 'online', null, { timeout: 30000 });
    assert.ok(requests.includes(PAD_INFO_PATH), 'the relay was probed');
    const btn = await page.evaluate(() => ({ hidden: document.querySelector('.cg-phone').hidden, entry: document.querySelectorAll('.pp-root').length }));
    assert.equal(btn.hidden, false, 'the title shows the phone button');

    // The phone button opens the panel: QR code, address, room code.
    await page.click('.cg-phone');
    let s = await panelState(page);
    assert.ok(s.open && s.shown, 'open after a click on the phone button');
    assert.equal(s.mode, 'title', 'the click did not start the game');
    assert.match(s.room, /^[A-HJKMNP-Z]{4}$/);
    assert.match(s.padUrl, new RegExp(`^http://[^/]+/pad\\.html\\?room=${s.room}$`));
    const dom = await page.evaluate(() => {
      const qr = document.querySelector('.pp-qr');
      return { url: document.querySelector('.pp-url').textContent, qr: [qr.width, qr.height], qrCss: [qr.getBoundingClientRect().width, qr.getBoundingClientRect().height] };
    });
    assert.equal(dom.url, s.padUrl, 'the address is shown as text');
    assert.equal(dom.qr[0], dom.qr[1]);
    assert.ok(dom.qr[0] >= 150, `a readable QR code (${dom.qr[0]} px)`);

    // Esc closes it and does not start the game; P opens it again.
    await page.keyboard.press('Escape');
    s = await panelState(page);
    assert.equal(s.open, false);
    await page.waitForTimeout(600);
    assert.equal((await panelState(page)).mode, 'title', 'Esc on the panel is not a start press');
    await page.keyboard.press('KeyP');
    assert.equal((await panelState(page)).open, true, 'P opens the panel on the title');

    // A phone joins while it is open: "connected", then it closes by itself.
    phone = await fakePhone(s.room);
    await until(async () => (await panelState(page)).joined, 10000, 'joined');
    const t0 = Date.now();
    await until(async () => !(await panelState(page)).open, 6000, 'auto close');
    const dt = Date.now() - t0;
    assert.ok(dt > 700 && dt < 4000, `closed ~1.5 s after the join (${dt} ms)`);
    assert.ok(phone.got.some((m) => m.t === 'hello'), 'the game greets the phone');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pp-badge')).display), 'block', 'the connected badge shows');

    // Open again: the phone's B closes it without starting; then its START starts the game.
    await page.keyboard.press('KeyP');
    assert.equal((await panelState(page)).open, true);
    await phone.tap('B');
    await until(async () => !(await panelState(page)).open, 5000, 'phone B closing the panel on the title');
    await page.waitForTimeout(400);
    assert.equal((await panelState(page)).mode, 'title', 'B is no start press');
    await phone.tap('START');
    await page.waitForFunction(() => window.__game.state.mode === 'play', null, { timeout: 30000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    await until(() => page.evaluate(() => window.__game.player.action !== 'spawn'), 60000, 'the drop-in');
    await page.waitForTimeout(1500);

    // Its stick moves Pip.
    const p0 = await page.evaluate(() => ({ ...window.__game.player.pos }));
    phone.set({ stickY: 1 });
    await until(async () => {
      const p = await page.evaluate(() => ({ ...window.__game.player.pos }));
      return Math.hypot(p.x - p0.x, p.z - p0.z) > 150;
    }, 30000, 'Pip moving');
    phone.set({});

    // Pip getting hurt rumbles the phone.
    await page.evaluate(() => window.__game.events.emit('hurt', { pos: window.__game.player.pos, amount: 1 }));
    await until(() => phone.got.some((m) => m.t === 'rumble' && m.ms === 120), 5000, 'rumble');

    // Pause with the phone's START, P opens the panel, the phone's B closes it (still paused).
    await phone.tap('START');
    await until(async () => (await panelState(page)).paused, 20000, 'pause');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyP');
    s = await panelState(page);
    assert.ok(s.open && s.shown, 'P opens the panel on the pause screen');
    await phone.tap('B');
    await until(async () => !(await panelState(page)).open, 20000, 'phone B closing the panel');
    assert.equal((await panelState(page)).paused, true, 'closing the panel does not unpause');
    // The pause legend's phone row is a click target too.
    await page.click('.pp-hit');
    assert.equal((await panelState(page)).open, true, 'a click on the legend row opens it');
    await page.keyboard.press('Escape');
    assert.equal((await panelState(page)).open, false);
    await page.waitForTimeout(300);
    assert.equal((await panelState(page)).paused, true, 'Esc on the panel does not unpause');
    await phone.tap('START');
    await until(async () => !(await panelState(page)).paused, 20000, 'unpause');

    // The phone leaves while its stick is pushed: Pip is released.
    phone.set({ stickX: 1 });
    await until(() => page.evaluate(() => window.__game.input.remote.stickX === 1), 5000, 'stick');
    phone.close();
    phone = null;
    await until(() => page.evaluate(() => !window.__game.remotePad.connected && window.__game.input.remote.stickX === 0), 5000, 'release');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pp-badge')).display), 'none', 'the badge goes');
    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    phone?.close();
    await page.close();
  }
});

test('?pad=0 (as on a static host): no probe, no phone button, P does nothing', { skip, timeout: 240000 }, async () => {
  const { page, errors, requests } = await gamePage('?mute=1&pad=0');
  try {
    await page.waitForTimeout(1500);
    const s = await page.evaluate(() => ({
      status: window.__game.remotePad.status,
      available: window.__game.remotePad.available,
      hidden: document.querySelector('.cg-phone').hidden,
    }));
    assert.deepEqual(s, { status: 'unavailable', available: false, hidden: true });
    assert.ok(!requests.includes(PAD_INFO_PATH) && !requests.includes(PAD_WS_PATH), 'nothing asked');
    await page.keyboard.press('KeyP');
    assert.equal(await page.evaluate(() => window.__game.phone.isOpen), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
