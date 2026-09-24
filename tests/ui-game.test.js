// Full-game HUD integration test (Vite + headless Chromium, ~20-60 s), opt-in:
//   E2E=1 node --test tests/ui-game.test.js
// Checks the wiring main.js owns: the HUD gets the event bus (red-coin numbers) and is
// exposed as __game.hud, and the UI root follows the renderer's 4:3 pillarbox viewport
// (view.alignOverlay(uiRoot)).
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
