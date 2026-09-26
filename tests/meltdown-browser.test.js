// AI RACE's meltdown in the real game (Vite dev server, headless Chromium), opt-in: E2E=1.
// With ?test=1: AI RACE on, the clock counts only while playing (a pause holds it), the warning
// banner and the red sky at 30 s, the sky on fire at 40 s (embers, the button dead, STOP
// ignored), the light at 46 s, a white picture at 53 s, then GAME OVER once (the card) whatever
// the lives left, the title with everything reset, and a fresh game. And: STOP before 40 s
// cancels it (the glow fades out) and AI RACE again starts a fresh 40 s.
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

async function open() {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}/?test=1&mute=1`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  // Log the meltdown's phases and game overs; Pip can't be hurt (no game over of his own).
  await page.evaluate(() => {
    const g = window.__game;
    window.__mlog = [];
    g.events.on('meltdown', (e) => window.__mlog.push(e.phase));
    g.events.on('gameOver', () => window.__mlog.push('gameOver'));
    g.player.takeDamage = () => false;
  });
  return { page, errors };
}

// What the page shows of the meltdown now.
const read = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    const sky = g.view.scene.getObjectByName('skyDome').material.storm;
    const alert = document.querySelector('.cg-alert');
    return {
      phase: g.meltdown.phase,
      seconds: g.meltdown.seconds,
      mode: g.state.mode,
      dark: g.state.dark,
      lives: g.state.lives,
      paused: g.state.paused,
      warn: g.view.melt.warn,
      fire: g.view.melt.fire,
      white: g.view.melt.white,
      meltOn: g.view.meltOn,
      darkness: g.view.darkness,
      skyWarn: sky.meltWarn.value,
      skyFire: sky.meltFire.value,
      embers: g.fx.rain.material.uniforms.uEmber.value,
      orb: g.fx.doom.orb.visible,
      wave: g.fx.doom.wave.visible,
      buttonDead: g.objects.button.dead,
      banner: alert ? alert.querySelectorAll('canvas').length : 0,
      card: !!document.querySelector('.cg-gameover'),
      log: [...window.__mlog],
    };
  });

// Pixels of the drawn picture (read right after a draw, before the buffer is swapped).
const pixels = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    g.render();
    const gl = g.view.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const out = [];
    const px = new Uint8Array(4);
    for (const [fx, fy] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.3], [0.3, 0.8], [0.7, 0.9], [0.5, 0.15]]) {
      gl.readPixels(Math.floor(fx * w), Math.floor(fy * h), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push([px[0], px[1], px[2]]);
    }
    return out;
  });

test('AI RACE not stopped: warning, fire, light, white, GAME OVER once, then the title with everything reset', { skip, timeout: 600000 }, async () => {
  const { page, errors } = await open();
  try {
    const step = (n, input = null) => page.evaluate(([k, i]) => window.__game.step(k, i), [n, input]);
    await page.evaluate(() => window.__game.setDark(true));
    await step(120);
    let s = await read(page);
    assert.equal(s.phase, 'race');
    assert.ok(Math.abs(s.seconds - 4) < 0.05, `the clock runs with the mode: ${s.seconds}`);
    const sunny = await pixels(page);
    // A pause holds the clock.
    await step(1, { START: true });
    s = await read(page);
    assert.equal(s.paused, true);
    const held = s.seconds;
    await step(90);
    assert.equal((await read(page)).seconds, held, 'paused time does not count');
    await step(1, { START: true });
    assert.equal((await read(page)).paused, false);

    // 30 s: the warning.
    await page.evaluate(() => window.__game.meltdown.skipTo(29.9));
    await step(36);
    s = await read(page);
    assert.equal(s.phase, 'warning');
    assert.equal(s.banner, 3, 'WARNING! / THE SKY IS OVERHEATING / POUND STOP!');
    assert.ok(s.warn > 0.3 && s.skyWarn > 0.3 && s.meltOn, 'the sky glows from the horizon');
    assert.equal(s.fire, 0);

    // 40 s: the sky catches fire; STOP does nothing any more.
    await page.evaluate(() => window.__game.meltdown.skipTo(40));
    await step(60);
    s = await read(page);
    assert.equal(s.phase, 'fire');
    assert.ok(s.fire > 0.9 && s.skyFire > 0.9 && s.embers > 0.9, 'flames, fiery grade, embers');
    assert.equal(s.buttonDead, true);
    assert.equal(s.banner, 0, 'the warning is gone');
    await page.evaluate(() => window.__game.setDark(false)); // as the button would
    s = await read(page);
    assert.equal(s.dark, true, 'too late to stop');
    assert.equal(s.phase, 'fire');

    // 46 s: the light; then brighter and brighter.
    await step(150);
    s = await read(page);
    assert.equal(s.phase, 'light');
    assert.equal(s.orb, true);
    await step(60);
    s = await read(page);
    assert.equal(s.wave, true, 'the shockwave races out');
    const mid = s.white;
    await step(90);
    s = await read(page);
    assert.ok(s.white > mid, 'brighter');
    // 53 s: all white.
    await step(45);
    s = await read(page);
    assert.equal(s.phase, 'white');
    assert.equal(s.white, 1);
    const white = await pixels(page);
    for (const p of white) assert.ok(p.every((v) => v >= 250), `white: ${p}`);
    assert.ok(sunny.some((p) => p.some((v) => v < 200)), 'the picture was not white before');
    assert.equal(s.mode, 'play', 'Pip is still playing');
    // 54 s: GAME OVER once, whatever the lives left.
    await step(40);
    s = await read(page);
    assert.equal(s.phase, 'over');
    assert.equal(s.mode, 'gameover');
    assert.equal(s.card, true, 'the GAME OVER card');
    assert.deepEqual(s.log, ['warning', 'fire', 'light', 'shock', 'white', 'over', 'gameOver']);
    await step(30); // frozen: nothing more happens
    assert.equal((await read(page)).log.filter((e) => e === 'gameOver').length, 1);

    // Then the title, with everything reset for the next game.
    await page.waitForFunction(() => window.__game.state.mode === 'title', null, { timeout: 20000 });
    s = await read(page);
    assert.equal(s.card, false);
    assert.equal(s.phase, 'idle');
    assert.equal(s.seconds, 0);
    assert.deepEqual([s.warn, s.fire, s.white, s.meltOn, s.darkness, s.skyFire, s.embers, s.orb, s.wave, s.dark], [0, 0, 0, false, 0, 0, 0, false, false, false]);
    assert.equal(s.buttonDead, false);
    assert.equal(s.lives, 4);
    await page.waitForSelector('.cg-title canvas', { timeout: 20000 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__game.state.mode === 'play', null, { timeout: 20000 });
    await step(30);
    s = await read(page);
    assert.equal(s.phase, 'idle', 'a fresh game: no race until AI RACE is pounded');
    const clear = await pixels(page);
    assert.ok(clear.some((p) => p.some((v) => v < 200)), 'the picture is back');
    // A new race starts afresh.
    await page.evaluate(() => window.__game.setDark(true));
    await step(30);
    s = await read(page);
    assert.equal(s.phase, 'race');
    assert.ok(s.seconds < 1.1);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('STOP before 40 s cancels the meltdown (the glow fades out); AI RACE again starts a fresh 40 s', { skip, timeout: 300000 }, async () => {
  const { page, errors } = await open();
  try {
    const step = (n) => page.evaluate((k) => window.__game.step(k), n);
    await page.evaluate(() => window.__game.setDark(true));
    await step(100);
    await page.evaluate(() => window.__game.meltdown.skipTo(34));
    await step(3);
    let s = await read(page);
    assert.equal(s.phase, 'warning');
    assert.ok(s.warn > 0.4);
    await page.evaluate(() => window.__game.setDark(false)); // STOP
    s = await read(page);
    assert.equal(s.phase, 'idle');
    assert.equal(s.dark, false);
    assert.equal(s.log.at(-1), 'cancelled');
    assert.equal(s.banner, 0, 'the warning banner goes');
    await step(20);
    s = await read(page);
    assert.ok(s.warn > 0 && s.warn < 0.5, 'fading out');
    await step(60);
    s = await read(page);
    assert.equal(s.warn, 0);
    assert.equal(s.meltOn, false);
    await page.evaluate(() => window.__game.setDark(true));
    await step(30);
    s = await read(page);
    assert.equal(s.phase, 'race');
    assert.ok(s.seconds < 1.1, 'a fresh 40 s');
    assert.equal(s.mode, 'play');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
