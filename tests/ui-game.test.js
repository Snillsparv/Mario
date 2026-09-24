// Full-game HUD integration test (Vite + headless Chromium, ~20-60 s), opt-in:
//   E2E=1 node --test tests/ui-game.test.js
// Checks the wiring main.js owns: the HUD gets the event bus (red-coin numbers) and is
// exposed as __game.hud, and the UI root follows the renderer's 4:3 pillarbox viewport
// (view.alignOverlay(uiRoot)). Also: the HUD, title card, GAME OVER card and sign dialog
// redraw at a new devicePixelRatio that comes without a CSS resize (window moved to another
// monitor), and the sign dialog sits in the picture, pages with B and hides on pause.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skip = !process.env.E2E && 'browser test: set E2E=1 to run';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let browser;
let page;

before(async () => {
  if (skip) return;
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(`${base}/?test=1&mute=1`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
}, { timeout: 240000 });

after(async () => {
  await browser?.close();
  await server?.close();
});

const nextFrames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('red coins pop their number in the real game', { skip, timeout: 60000 }, async () => {
  assert.ok(await page.evaluate(() => !!window.__game.hud), 'main.js must expose the HUD as __game.hud');
  await page.evaluate(() => {
    window.__game.step(1);
    window.__game.events.emit('coin', { value: 2, red: true, index: 1 });
  });
  await nextFrames();
  assert.equal(await page.evaluate(() => window.__game.hud.redPopup?.n), 1, 'HUD must be built with { events }');
});

test('HUD stays inside the 4:3 pillarbox picture', { skip, timeout: 60000 }, async () => {
  const { vp, box } = await page.evaluate(async () => {
    const { view } = window.__game;
    view.setPillarbox(true);
    window.__game.step(1);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = document.querySelector('#ui canvas').getBoundingClientRect(); // the HUD (no title in test mode)
    const result = { vp: { ...view.viewport }, box: { x: b.x, y: b.y, width: b.width, height: b.height } };
    view.setPillarbox(false); // the setting is persisted; leave it as found
    return result;
  });
  assert.ok(vp.x > 0, 'pillarbox bars expected at 16:9');
  for (const k of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(box[k] - vp[k]) <= 1, `HUD ${k} ${box[k]} != picture ${vp[k]} (align the UI root with view.alignOverlay)`);
  }
});

test('HUD setVisible and the GAME OVER card follow the picture', { skip, timeout: 60000 }, async () => {
  const r = await page.evaluate(async () => {
    const { GameOverCard } = await import('/src/ui/GameOverCard.js');
    const { hud, view } = window.__game;
    const frames = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    hud.setVisible(false);
    const hidden = getComputedStyle(hud.el).visibility;
    hud.setVisible(true);
    const shown = getComputedStyle(hud.el).visibility;
    view.setPillarbox(true);
    window.__game.step(1);
    await frames();
    const card = new GameOverCard(document.getElementById('ui')).show();
    await frames();
    const box = card.el.getBoundingClientRect();
    const text = card.text.getBoundingClientRect();
    const out = {
      hidden,
      shown,
      vp: { ...view.viewport },
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      textCentre: [text.x + text.width / 2, text.y + text.height / 2],
      textWidth: text.width,
    };
    card.remove();
    out.left = document.querySelectorAll('.cg-gameover').length;
    view.setPillarbox(false); // the setting is persisted; leave it as found
    return out;
  });
  assert.equal(r.hidden, 'hidden');
  assert.equal(r.shown, 'visible');
  for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(r.box[k] - r.vp[k]) <= 1, `card ${k} ${r.box[k]} != picture ${r.vp[k]}`);
  assert.ok(Math.abs(r.textCentre[0] - (r.vp.x + r.vp.width / 2)) <= 2 && Math.abs(r.textCentre[1] - (r.vp.y + r.vp.height / 2)) <= 2, 'GAME OVER is centred');
  assert.ok(r.textWidth < r.vp.width * 0.6, `GAME OVER ${r.textWidth} px wide in a ${r.vp.width} px picture`);
  assert.equal(r.left, 0, 'remove() takes the card away');
});

test('sign dialog: upper middle of the 4:3 picture (clear of Pip), pages with B, closes once, hides on pause', { skip, timeout: 60000 }, async () => {
  const r = await page.evaluate(async () => {
    const { events, dialog, view, step } = window.__game;
    const frames = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const closed = [];
    const off = events.on('dialogClosed', (e) => closed.push(e));
    view.setPillarbox(true);
    step(1);
    await frames();
    const sign = { id: 'e2e', pages: ['First page.', 'Second and last page.'] };
    events.emit('signRead', { sign });
    step(30);
    await frames();
    step(1); // redraw after the pillarbox resize (?test=1 has no rAF loop driving the box)
    await frames();
    const b = dialog.canvas.getBoundingClientRect();
    const box = dialog.box; // panel inside the canvas, device px
    const dpr = devicePixelRatio;
    const panel = { x: b.x + box.x / dpr, y: b.y + box.y / dpr, width: box.w / dpr, height: box.h / dpr };
    const vp = { ...view.viewport };
    const pixels = dialog.ctx.getImageData(Math.round(box.x + box.w / 2), Math.round(box.y + box.h / 2), 1, 1).data[3];
    step(1, { START: true }); // pause: the pause screen shows, the box hides
    const paused = getComputedStyle(dialog.el).visibility;
    step(1);
    step(1, { START: true });
    const resumed = getComputedStyle(dialog.el).visibility;
    step(1);
    const pages = [dialog.screenIndex];
    step(1, { B: true });
    pages.push(dialog.screenIndex);
    step(1);
    step(1, { B: true }); // completes the second page
    step(1);
    step(1, { B: true }); // closes
    const open = dialog.isOpen;
    step(5, { B: true }); // held: nothing more
    off();
    view.setPillarbox(false); // the setting is persisted; leave it as found
    step(1);
    return { panel, vp, pixels, paused, resumed, pages, open, closed: closed.map((e) => e.sign.id), action: window.__game.player.action };
  });
  const { panel, vp } = r;
  assert.ok(panel.x >= vp.x && panel.x + panel.width <= vp.x + vp.width, `panel ${JSON.stringify(panel)} inside picture ${JSON.stringify(vp)}`);
  assert.ok(Math.abs(panel.x + panel.width / 2 - (vp.x + vp.width / 2)) <= 2, 'centred');
  assert.ok(panel.y >= vp.y && panel.y + panel.height / 2 < vp.y + vp.height * 0.5, 'in the upper half, clear of the hero');
  assert.ok(r.pixels > 150, 'the panel is drawn (dark, mostly opaque)');
  assert.equal(r.paused, 'hidden');
  assert.equal(r.resumed, 'visible');
  assert.deepEqual(r.pages, [0, 1]);
  assert.equal(r.open, false);
  assert.deepEqual(r.closed, ['e2e']);
});

// Last: it changes the page's device metrics (restored at the end).
test('HUD, title and GAME OVER card redraw when only the devicePixelRatio changes', { skip, timeout: 60000 }, async () => {
  await page.evaluate(async () => {
    const { TitleScreen } = await import('/src/ui/TitleScreen.js');
    const { GameOverCard } = await import('/src/ui/GameOverCard.js');
    const ui = document.getElementById('ui');
    window.__dprTitle = new TitleScreen(ui, { audio: { muted: true, unlock() {}, playMusic() {} } });
    window.__dprTitleDone = false;
    window.__dprTitle.show().then(() => (window.__dprTitleDone = true));
    window.__dprCard = new GameOverCard(ui).show();
    window.__game.step(1);
    window.__game.events.emit('signRead', { sign: { id: 'dpr', pages: ['Some text on a sign.'] } });
    window.__game.step(30);
  });
  await nextFrames();
  const read = () =>
    page.evaluate(() => {
      const { hud } = window.__game;
      const press = window.__dprTitle.pieces.press;
      const card = window.__dprCard;
      return {
        dpr: devicePixelRatio,
        hud: [hud.canvas.width, hud.canvas.height, hud.s],
        hudCss: hud.canvas.getBoundingClientRect().width,
        press: [press.px, press.el.width, parseFloat(press.el.style.width)],
        card: [card.px, card.text.width, parseFloat(card.text.style.width)],
        dialog: [window.__game.dialog.canvas.width, parseFloat(window.__game.dialog.canvas.style.width), window.__game.dialog.m.fp],
      };
    });
  const a = await read();
  const cdp = await page.context().newCDPSession(page);
  const metrics = (deviceScaleFactor) => cdp.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor, mobile: false });
  let b;
  try {
    await metrics(2 * a.dpr);
    await page.waitForFunction((d) => devicePixelRatio === d, 2 * a.dpr);
    await nextFrames();
    await page.waitForTimeout(100); // media-query change events
    b = await read();
  } finally {
    await metrics(a.dpr);
    await page.evaluate(() => {
      window.__dprCard.remove();
      window.__game.dialog.close();
    });
    await page.keyboard.press('Enter'); // dismiss the title card
    await page.waitForFunction(() => window.__dprTitleDone === true, null, { timeout: 5000 });
    await cdp.detach();
  }
  // Same CSS size, twice the device pixels: every layer redrew at the new resolution.
  assert.equal(b.hudCss, a.hudCss, 'CSS size unchanged');
  assert.deepEqual(b.hud, [a.hud[0] * 2, a.hud[1] * 2, a.hud[2] * 2], 'HUD canvas at device resolution');
  assert.equal(b.press[0], a.press[0] * 2, 'title PRESS START redrawn');
  assert.ok(b.press[1] > a.press[1] * 1.9, 'title canvas has twice the pixels');
  assert.ok(Math.abs(b.press[2] - a.press[2]) <= 2, `title text keeps its CSS size (${a.press[2]} -> ${b.press[2]})`);
  assert.equal(b.card[0], a.card[0] * 2, 'GAME OVER redrawn');
  assert.ok(Math.abs(b.card[2] - a.card[2]) <= 2, `GAME OVER keeps its CSS size (${a.card[2]} -> ${b.card[2]})`);
  assert.ok(b.dialog[2] > a.dialog[2] * 1.5, `dialog text redrawn at the new ratio (${a.dialog[2]} -> ${b.dialog[2]} px per font pixel)`);
  assert.ok(b.dialog[0] > a.dialog[0] * 1.6, 'dialog canvas has about twice the pixels');
  assert.ok(Math.abs(b.dialog[1] / a.dialog[1] - 1) <= 0.2, `dialog keeps about its CSS size (${a.dialog[1]} -> ${b.dialog[1]})`);
});
