// The face screen in the real game (Vite dev server, headless Chromium): it is opt-in (?face=1
// opens it; the title's Start goes straight to play), drawn by the game's renderer instead of
// the world; a mouse drag on Pip's cheek grabs and
// stretches it (a held handle, the surface displaced, a surprised face, the fist pointer),
// letting go wobbles it back through rest and settles, a drag on the sky turns the head and the
// wheel zooms, and Start goes on to play (not paused, the scene and its listeners gone).
// ?face=1 opens it without the title; ?test=1 and ?skipTitle=1 never show it.
// Opt-in: E2E=1 (Vite + headless Chromium).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}, { timeout: 120000 });

after(async () => {
  await browser?.close();
  await server?.close();
});

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}/${query}`, { waitUntil: 'load', timeout: 180000 });
  return { page, errors };
}

const faceReady = (page) => page.waitForFunction(() => window.__game?.state.mode === 'face' && window.__game.face?.ready, null, { timeout: 60000 });
const state = (page) => page.evaluate(() => window.__game.face.state());

test('by default the title card goes straight to play, with no face screen', { skip, timeout: 300000 }, async () => {
  const { page, errors } = await open('?mute=1');
  try {
    await page.waitForSelector('.cg-title canvas', { timeout: 180000 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__game?.state.mode === 'play', null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__game.face), null);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('?face=1: drag stretches Pip, letting go wobbles back, the sky turns him, Start plays', { skip, timeout: 300000 }, async () => {
  const { page, errors } = await open('?face=1&mute=1');
  try {
    await faceReady(page);
    const shown = await page.evaluate(() => ({
      title: !!document.querySelector('.cg-title'),
      overlay: !!document.querySelector('.cg-face .cg-face-hint canvas'),
      drawn: window.__game.view.viewScene === window.__game.face.scene,
      hud: window.__game.hud.visible,
      triangles: window.__game.face.state().triangles,
    }));
    assert.deepEqual({ ...shown, triangles: undefined }, { title: false, overlay: true, drawn: true, hud: false, triangles: undefined });
    assert.ok(shown.triangles > 20000 && shown.triangles < 80000, `a dense head: ${shown.triangles} triangles`);
    await page.waitForTimeout(1200); // the pop-in settles

    // Grab the cheek with the mouse and pull it out to the right.
    const at = await page.evaluate(() => window.__game.face.project(13.8, -8.5, 25.6));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(at.x + i * 14, at.y + i * 4);
    await page.waitForTimeout(600);
    const held = await page.evaluate(() => {
      const f = window.__game.face;
      const h = f.stretch.handles.find((x) => x.held);
      return {
        s: f.state(),
        grab: h && [h.gx, h.gy, h.gz],
        shown: h ? f.displacementAt(h.gx, h.gy, h.gz) : 0,
        far: h ? f.displacementAt(-h.gx, h.gy, h.gz) : 0,
        fist: getComputedStyle(document.querySelector('.cg-face-cursor')).display !== 'none' && document.querySelectorAll('.cg-face-cursor canvas')[1].style.display === 'block',
      };
    });
    assert.equal(held.s.handles.length, 1, 'one handle');
    assert.ok(Math.hypot(held.grab[0] - 13.8, held.grab[1] + 8.5, held.grab[2] - 25.6) < 4, `grabbed at the cheek: ${held.grab}`);
    assert.ok(held.s.handles[0].offset > 20, `pulled out: ${held.s.handles[0].offset}`);
    assert.ok(held.shown > 20, `the cheek's surface moved ${held.shown}`);
    assert.equal(held.far, 0, 'the other cheek stays put');
    assert.ok(['surprise', 'alarm', 'wince', 'blink'].includes(held.s.expression), held.s.expression);
    assert.ok(held.fist, 'the pointer is a fist while pulling');

    // Let go: it swings back past rest (a wobble) and settles, and the slot frees.
    await page.evaluate(() => {
      const h = window.__game.face.stretch.handles.find((x) => x.held);
      window.__swing = [];
      window.__swingDone = false;
      const sample = () => {
        window.__swing.push(h.active ? h.ox : 0);
        if (h.active && window.__swing.length < 240) requestAnimationFrame(sample);
        else window.__swingDone = true;
      };
      requestAnimationFrame(sample);
    });
    await page.mouse.up();
    await page.waitForFunction(() => window.__swingDone, null, { timeout: 120000 });
    const swing = await page.evaluate(() => window.__swing);
    assert.ok(Math.min(...swing) < -5, `overshoots the other way: ${Math.min(...swing).toFixed(1)}`);
    await page.waitForFunction(() => window.__game.face.state().handles.length === 0, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__game.face.displacementAt(13.8, -8.5, 25.6)), 0, 'back at rest');

    // A drag on the sky turns the head; the wheel zooms.
    await page.mouse.move(80, 270);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(80 + i * 20, 270);
    await page.waitForTimeout(400);
    const turned = await state(page);
    assert.ok(turned.yaw > 0.4 && turned.handles.length === 0, `turned ${turned.yaw}`);
    await page.mouse.up();
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(800);
    const back = await state(page);
    assert.ok(Math.abs(back.yaw) < turned.yaw * 0.5, 'swinging back');
    assert.ok(back.zoom > 1.1, `zoomed in ${back.zoom}`);

    // Start: on to play once released; the press is not seen as a fresh one (no pause).
    await page.keyboard.down('Enter');
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.__game.state.mode), 'face', 'waits for the release');
    await page.keyboard.up('Enter');
    await page.waitForFunction(() => window.__game.state.mode === 'play', null, { timeout: 20000 });
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      paused: window.__game.state.paused,
      face: window.__game.face,
      view: window.__game.view.viewScene,
      overlay: !!document.querySelector('.cg-face'),
      hud: window.__game.hud.visible,
      ready: window.__ready === true,
    }));
    assert.deepEqual(after, { paused: false, face: null, view: null, overlay: false, hud: true, ready: true });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('?face=1 opens the face screen alone; two touch points pull two handles; Space starts', { skip, timeout: 300000 }, async () => {
  const { page, errors } = await open('?face=1&mute=1');
  try {
    await faceReady(page);
    assert.equal(await page.evaluate(() => !!document.querySelector('.cg-title')), false, 'no title card');
    await page.waitForTimeout(1000);
    // Two fingers (the scripted pointer path the real handlers share) on both cheeks.
    await page.evaluate(() => {
      const f = window.__game.face;
      const a = f.projectShare(13.8, -8.5, 25.6);
      const b = f.projectShare(-13.8, -8.5, 25.6);
      f.pointer('down', a.x, a.y, { id: 11, pointerType: 'touch' });
      f.pointer('down', b.x, b.y, { id: 12, pointerType: 'touch' });
      f.pointer('move', a.x + 0.2, a.y, { id: 11, pointerType: 'touch' });
      f.pointer('move', b.x - 0.2, b.y, { id: 12, pointerType: 'touch' });
    });
    await page.waitForTimeout(500);
    const s = await state(page);
    assert.equal(s.handles.filter((h) => h.held).length, 2, 'two held handles');
    assert.ok(s.handles.every((h) => h.offset > 20), 'both pulled');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.cg-face-cursor')).display), 'none', 'no mitten on touch');
    await page.evaluate(() => {
      window.__game.face.pointer('up', 0, 0, { id: 11, pointerType: 'touch' });
      window.__game.face.pointer('up', 0, 0, { id: 12, pointerType: 'touch' });
    });
    const wob = await state(page);
    assert.equal(wob.handles.filter((h) => !h.held).length, 2, 'both wobble at once');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__game.state.mode === 'play', null, { timeout: 20000 });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.__game.state.paused), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('?test=1 and ?skipTitle=1 go straight into play: no face screen', { skip, timeout: 240000 }, async () => {
  for (const q of ['?test=1', '?skipTitle=1&mute=1']) {
    const { page, errors } = await open(q);
    try {
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
      const s = await page.evaluate(() => ({ mode: window.__game.state.mode, face: window.__game.face, overlay: !!document.querySelector('.cg-face') }));
      assert.deepEqual(s, { mode: 'play', face: null, overlay: false }, q);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
});
