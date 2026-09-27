// The title's game choice (ui/raceChoice.js): WITH AI RACE (the default) or WITHOUT, which keys
// pick which, how it is remembered, and that its texts are in the pixel font and fit the card.
// The choice on the real title card (keys, a click, the button behind the card, the saved
// choice after a reload) runs in the browser with E2E=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RACE_CHOICES, loadRaceChoice, saveRaceChoice, choiceForKey } from '../src/ui/raceChoice.js';
import { SMALL_FONT, measureText, missingGlyphs } from '../src/ui/bitmapFont.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

test('two options, with the AI RACE button first (left) and without it second', () => {
  assert.deepEqual(RACE_CHOICES.map((c) => c.on), [true, false]);
  assert.deepEqual(RACE_CHOICES.map((c) => c.label), ['WITH AI RACE', 'WITHOUT AI RACE']);
  const width = RACE_CHOICES.reduce((w, c) => w + measureText(SMALL_FONT, c.label) * 1.25 + 8, 8);
  assert.ok(width <= 300, `the row fits the 320-wide card: ${width}`);
  for (const c of RACE_CHOICES) {
    assert.deepEqual(missingGlyphs(SMALL_FONT, c.label), [], c.label);
    assert.ok(!/n64|nintendo|mario/i.test(c.label));
  }
});

test('keys: left / A pick WITH, right / D pick WITHOUT, up / down / W / S / Tab switch', () => {
  for (const cur of [true, false]) {
    assert.equal(choiceForKey('ArrowLeft', cur), true);
    assert.equal(choiceForKey('KeyA', cur), true);
    assert.equal(choiceForKey('ArrowRight', cur), false);
    assert.equal(choiceForKey('KeyD', cur), false);
    for (const k of ['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'Tab']) assert.equal(choiceForKey(k, cur), !cur, k);
  }
  for (const k of ['Enter', 'Space', 'Escape', 'KeyP', 'KeyF', 'KeyV', 'Digit9', 'KeyJ']) assert.equal(choiceForKey(k, true), null, k);
});

test('remembered in storage; WITH when nothing (or nothing readable) is saved', () => {
  const s = memoryStorage();
  assert.equal(loadRaceChoice(s), true, 'first visit: with');
  assert.equal(saveRaceChoice(false, s), true);
  assert.equal(loadRaceChoice(s), false);
  assert.equal(saveRaceChoice(true, s), true);
  assert.equal(loadRaceChoice(s), true);
  assert.equal(loadRaceChoice(null), true);
  assert.equal(saveRaceChoice(false, null), false);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
  assert.equal(loadRaceChoice(broken), true);
  assert.equal(saveRaceChoice(false, broken), false);
});

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

test('the title: no phone button; right picks WITHOUT (the button vanishes), a click picks WITH, the choice is remembered', { skip, timeout: 300000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const open = async () => {
    await page.goto(`${base}/?mute=1&pad=0`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => !!window.__game && !!document.querySelector('.cg-title .cg-opt'), null, { timeout: 180000 }); // (__ready comes after the title)
  };
  const look = () =>
    page.evaluate(() => {
      const b = window.__game.objects.button;
      const opts = [...document.querySelectorAll('.cg-title .cg-opt')];
      return {
        mode: window.__game.state.mode,
        selected: opts.map((o) => o.classList.contains('cg-sel')),
        shown: opts.map((o) => o.getBoundingClientRect().width > 0),
        button: { state: b.state, visible: b.mesh.visible },
        phoneButton: !!document.querySelector('.cg-phone'),
        saved: localStorage.getItem('castleGrounds.aiRace.v1'),
      };
    });
  try {
    await open();
    let s = await look();
    assert.equal(s.phoneButton, false, 'the title has no phone button');
    assert.deepEqual(s.shown, [true, true], 'both options show');
    assert.deepEqual(s.selected, [true, false], 'WITH AI RACE first');
    assert.deepEqual(s.button, { state: 'up', visible: true });

    await page.keyboard.press('ArrowRight');
    s = await look();
    assert.equal(s.mode, 'title', 'picking does not start the game');
    assert.deepEqual(s.selected, [false, true]);
    assert.deepEqual(s.button, { state: 'gone', visible: false }, 'the button vanishes behind the card');
    assert.equal(s.saved, 'off');

    // A click on the first option picks it and does not start either.
    await page.click('.cg-title .cg-opt >> nth=0');
    s = await look();
    assert.equal(s.mode, 'title');
    assert.deepEqual(s.selected, [true, false]);
    assert.deepEqual(s.button, { state: 'up', visible: true });

    // WITHOUT, then start: the game plays without the button.
    await page.keyboard.press('KeyD');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__game.state.mode === 'play', null, { timeout: 30000 });
    s = await page.evaluate(() => ({ state: window.__game.objects.button.state, visible: window.__game.objects.button.mesh.visible }));
    assert.deepEqual(s, { state: 'gone', visible: false });

    // Remembered after a reload.
    await open();
    s = await look();
    assert.deepEqual(s.selected, [false, true], 'WITHOUT is still picked');
    assert.deepEqual(s.button, { state: 'gone', visible: false });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
