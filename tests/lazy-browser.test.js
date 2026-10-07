// The game's lazy chunks in the real built game (vite build + vite preview, headless Chromium,
// no ?test: the real-time loop and main's background prefetch), opt-in: E2E=1. The hall's chunk
// held back on the network: walking into the castle door the wipe closes and stays covered (no
// switch, Jonas still) until it arrives, then he is in the Great Hall. The hall's chunk failing
// to load: the wipe opens again on the porch (no switch, Jonas free to walk), with one warning
// for the failed load and no page error; once the network is back the next try takes him in.
// AI RACE switched on before its objects' chunk is in (held back on the network): the storm
// waits for them, then starts with the beast there. A normal boot (the game choice and the
// title, muted) asks for nothing but main before the menus show, but the lane's chunk and its
// children and the workers (which the boot fetches beside the workers, as before), then fetches
// the hall's and the skerries' chunks in the background.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skip = !process.env.E2E && 'browser test: set E2E=1 to run';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let outDir;
let server;
let browser;
let base;

before(async () => {
  if (skip) return;
  const { build, preview } = await import('vite');
  const { chromium } = await import('playwright');
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'castle-lazy-'));
  await build({ root, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  server = await preview({ root, logLevel: 'silent', build: { outDir }, preview: { port: 0, host: '127.0.0.1', strictPort: false, open: false } });
  base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}, { timeout: 180000 });

after(async () => {
  await browser?.close();
  await server?.close();
  if (outDir) await fs.rm(outDir, { recursive: true, force: true });
});

const chunkOf = (url) => url.replace(/^.*\//, '').replace(/-[\w-]{8}\.js$/, '');

async function open(query, route) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  const warnings = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  if (route) await page.route(/\/assets\/hall-[\w-]{8}\.js(\?.*)?$/, route);
  await page.goto(`${base}/${query}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  return { page, errors, warnings };
}

// Up the porch steps into the castle door (the real-time loop running, the stick held forward
// through an input override) until a warp starts.
async function walkIn(page) {
  await page.evaluate(() => {
    const g = window.__game;
    g.player.teleport(0, 300, -300, Math.PI);
    g.player.setAction('idle');
    g.camera.reset(g.player);
    g.input.setOverride({ stickY: 1 });
  });
  await page.waitForFunction(() => window.__game.snapshot().warp !== null, null, { timeout: 30000, polling: 20 });
  await page.evaluate(() => window.__game.input.setOverride(null));
}

test('the hall held back on the network: the castle door wipe stays covered, Jonas still, until its chunk is in; then he is in the Great Hall', { skip, timeout: 240000 }, async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  let asked = 0;
  const { page, errors } = await open('?skipTitle=1&mute=1&look=classic', async (r) => {
    asked++;
    await held;
    await r.continue();
  });
  try {
    await walkIn(page);
    await page.waitForFunction(() => window.__game.areas.phase === 'hold', null, { timeout: 10000, polling: 20 });
    const at = await page.evaluate(() => ({ ...window.__game.player.pos }));
    await page.waitForTimeout(1500);
    const waiting = await page.evaluate(() => {
      const g = window.__game;
      return { phase: g.areas.phase, area: g.area, wipe: g.areas.wipe(0.5).amount, pos: { ...g.player.pos } };
    });
    assert.equal(asked, 1, "the hall's chunk asked for once");
    assert.equal(waiting.phase, 'hold', 'still covered');
    assert.equal(waiting.area, 'grounds');
    assert.equal(waiting.wipe, 1);
    assert.ok(Math.hypot(waiting.pos.x - at.x, waiting.pos.z - at.z) < 1, 'Jonas waits where he stood');
    release();
    await page.waitForFunction(() => window.__game.area === 'hall' && window.__game.areas.phase === null, null, { timeout: 30000, polling: 50 });
    assert.equal(await page.evaluate(() => window.__game.areas.current.entries.front !== undefined), true);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("the hall's chunk failing to load: the wipe opens again on the porch, no switch, one warning, no page error; once the network is back the next try takes him in", { skip, timeout: 240000 }, async () => {
  let block = true;
  const { page, errors, warnings } = await open('?skipTitle=1&mute=1&look=classic', (r) => (block ? r.abort() : r.continue()));
  const failures = () => warnings.filter((w) => /\[areas\] hall: its code did not load/.test(w)).length;
  try {
    // (main's background prefetch tries it first: its warning.)
    await page.waitForFunction(() => true, null, { timeout: 1000 });
    for (let i = 0; i < 100 && failures() === 0; i++) await page.waitForTimeout(100);
    assert.equal(failures(), 1, 'the prefetch failed');
    await walkIn(page);
    await page.waitForFunction(() => window.__game.areas.phase === null, null, { timeout: 30000, polling: 50 });
    const after = await page.evaluate(() => ({ area: window.__game.area, wipe: window.__game.areas.wipe(1).amount, pos: { ...window.__game.player.pos } }));
    assert.equal(after.area, 'grounds', 'no switch');
    assert.equal(after.wipe, 0, 'the picture open again');
    assert.ok(after.pos.z > -800 && after.pos.y > 200, `on the porch (${JSON.stringify(after.pos)})`);
    assert.equal(failures(), 2, `one warning for the door's try (${warnings.join(' | ')})`);
    // (Chromium reports each refused request itself as a console error: those only.)
    assert.deepEqual(errors.filter((e) => !/Failed to load resource|net::ERR_FAILED/.test(e)), []);
    // He walks away again, off the door's apron...
    await page.evaluate(() => window.__game.input.setOverride({ stickY: -1 }));
    await page.waitForFunction(() => window.__game.objects.door.armed, null, { timeout: 10000, polling: 50 });
    const away = await page.evaluate(() => (window.__game.input.setOverride(null), { ...window.__game.player.pos }));
    assert.ok(Math.hypot(away.x - after.pos.x, away.z - after.pos.z) > 50, 'free to walk');
    // ...and, the network back, in again: the chunk is fetched anew (Chromium keeps a failed
    // import failed: core/chunks.js retries under a fresh query) and he is in the hall.
    block = false;
    await walkIn(page);
    await page.waitForFunction(() => window.__game.area === 'hall' && window.__game.areas.phase === null, null, { timeout: 30000, polling: 50 });
  } finally {
    await page.close();
  }
});

test("AI RACE switched on before its objects' chunk is in: the storm waits for them, then starts with the beast there", { skip, timeout: 240000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route(/\/assets\/aiRace-[\w-]{8}\.js(\?.*)?$/, async (r) => {
    await held;
    await r.continue();
  });
  try {
    await page.goto(`${base}/?skipTitle=1&mute=1&look=classic`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
    // (As the button's pound does: 'aiRaceButton' { on: true }.)
    await page.evaluate(() => window.__game.setDark(true));
    await page.waitForTimeout(1500);
    const waiting = await page.evaluate(() => ({ dark: window.__game.state.dark, beast: !!window.__game.objects.beast, mode: window.__game.state.mode }));
    assert.deepEqual(waiting, { dark: false, beast: false, mode: 'play' }, 'no storm without its objects');
    release();
    await page.waitForFunction(() => window.__game.state.dark && window.__game.state.darkT > 0.2, null, { timeout: 60000, polling: 100 });
    const on = await page.evaluate(() => ({ beast: window.__game.objects.beast?.state, halls: !!window.__game.objects.halls, grip: window.__game.player.tailGrip === window.__game.objects.beast?.grip }));
    assert.ok(on.beast && on.beast !== 'hidden', `the beast rises (${on.beast})`);
    assert.equal(on.halls, true);
    assert.equal(on.grip, true, 'its tail grip handed to Jonas');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('a normal boot asks for main alone before the menus (and the lane with its children and the workers, as the boot always did), then fetches the hall and the skerries in the background', { skip, timeout: 240000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // When main set window.__game (just before the menus), on the page's clock.
  await page.addInitScript(() => {
    let game;
    Object.defineProperty(window, '__game', {
      configurable: true,
      get: () => game,
      set: (v) => {
        game = v;
        window.__gameAt = performance.now();
      },
    });
  });
  try {
    await page.goto(`${base}/?mute=1`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__game?.state.mode === 'title', null, { timeout: 180000 });
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /\/skerries-[\w-]{8}\.js$/.test(e.name)), null, { timeout: 60000, polling: 100 });
    const { at, scripts } = await page.evaluate(() => ({
      at: window.__gameAt,
      scripts: performance
        .getEntriesByType('resource')
        .filter((e) => /\.js$/.test(e.name))
        .map((e) => ({ name: e.name, start: e.startTime })),
    }));
    const early = scripts.filter((s) => s.start < at).map((s) => chunkOf(s.name));
    const BOOT = new Set(['main', 'lane', 'realLook', 'laneBoss', 'laneRealWorker', 'logoWorker']);
    assert.ok(early.includes('main'));
    for (const name of early) assert.ok(BOOT.has(name), `${name} asked for before the menus (${early.join(', ')})`);
    const late = scripts.filter((s) => s.start >= at).map((s) => chunkOf(s.name));
    for (const name of ['hall', 'skerries']) assert.ok(late.includes(name), `${name} fetched in the background (${late.join(', ')})`);
    assert.ok(late.indexOf('hall') < late.indexOf('skerries'), 'one at a time, the hall first');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
