// The game choice (ui/raceChoice.js, ui/ChoiceScreen.js): WITH AI RACE (the default) or WITHOUT,
// which keys pick which, how it is remembered, and that its texts are in the pixel font and fit
// the screen. In the browser (E2E=1): the choice screen comes first, before the title card
// (which has no choice and no phone button); keys and a click pick, the button behind the
// screen appears and vanishes, Enter or the click plays and the title follows, and the choice
// is remembered after a reload.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RACE_CHOICES, loadRaceChoice, saveRaceChoice, choiceForKey } from '../src/ui/raceChoice.js';
import { RACE_TEXTS, RACE_SMALL_STRINGS, RACE_BIG_STRINGS } from '../src/ui/raceChoice.js';
import { SMALL_FONT, BIG_FONT, measureText, missingGlyphs } from '../src/ui/bitmapFont.js';
import { SMALL_STRINGS, BIG_STRINGS } from '../src/ui/hudLogic.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

test('two options, with the AI RACE button first (top) and without it second', () => {
  assert.deepEqual(RACE_CHOICES.map((c) => c.on), [true, false]);
  assert.deepEqual(RACE_CHOICES.map((c) => c.label), ['WITH AI RACE', 'WITHOUT AI RACE']);
  assert.ok(RACE_CHOICES.every((c) => c.about.length > 0), 'each says what it means');
  // Big-font labels and title, small-font lines: in the fonts, checked, and inside the 320-wide screen.
  for (const s of RACE_BIG_STRINGS) {
    assert.deepEqual(missingGlyphs(BIG_FONT, s), [], s);
    assert.ok(BIG_STRINGS.includes(s), `glyph coverage checks "${s}"`);
    assert.ok(measureText(BIG_FONT, s) * 1.2 + 24 <= 300, s);
  }
  for (const s of RACE_SMALL_STRINGS) {
    assert.deepEqual(missingGlyphs(SMALL_FONT, s), [], s);
    assert.ok(SMALL_STRINGS.includes(s), `glyph coverage checks "${s}"`);
    assert.ok(measureText(SMALL_FONT, s) <= 300, s);
  }
  assert.ok(RACE_BIG_STRINGS.includes(RACE_TEXTS.title));
  for (const s of [...RACE_BIG_STRINGS, ...RACE_SMALL_STRINGS]) assert.ok(!/n64|nintendo|mario/i.test(s), s);
});

test('keys: up / W / left / A pick WITH, down / S / right / D pick WITHOUT, Tab switches', () => {
  for (const cur of [true, false]) {
    for (const k of ['ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA']) assert.equal(choiceForKey(k, cur), true, k);
    for (const k of ['ArrowDown', 'KeyS', 'ArrowRight', 'KeyD']) assert.equal(choiceForKey(k, cur), false, k);
    assert.equal(choiceForKey('Tab', cur), !cur);
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

test('the choice screen comes first: keys and a click pick, Enter plays, then the title (no choice, no phone button); remembered', { skip, timeout: 300000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const open = async () => {
    await page.goto(`${base}/?mute=1&pad=0`, { waitUntil: 'load', timeout: 180000 });
    // (__ready comes only after the menus)
    await page.waitForFunction(() => !!window.__game && !!document.querySelector('.cg-choose .cg-c-opt'), null, { timeout: 180000 });
  };
  const look = () =>
    page.evaluate(() => {
      const b = window.__game.objects.button;
      const opts = [...document.querySelectorAll('.cg-choose .cg-c-opt')];
      return {
        mode: window.__game.state.mode,
        choice: !!document.querySelector('.cg-choose'),
        title: !!document.querySelector('.cg-title'),
        selected: opts.map((o) => o.classList.contains('cg-sel')),
        about: [...document.querySelectorAll('.cg-choose .cg-c-about')].map((a) => !a.hidden),
        button: { state: b.state, visible: b.mesh.visible },
        saved: localStorage.getItem('castleGrounds.aiRace.v1'),
      };
    });
  try {
    await open();
    let s = await look();
    assert.equal(s.title, false, 'the choice screen comes before the title card');
    assert.deepEqual(s.selected, [true, false], 'WITH AI RACE first');
    assert.deepEqual(s.about, [true, false], 'the line under the options explains the picked one');
    assert.deepEqual(s.button, { state: 'up', visible: true });

    await page.keyboard.press('ArrowDown');
    s = await look();
    assert.equal(s.choice, true, 'picking does not leave the screen');
    assert.deepEqual(s.selected, [false, true]);
    assert.deepEqual(s.about, [false, true]);
    assert.deepEqual(s.button, { state: 'gone', visible: false }, 'the button vanishes behind the screen');
    assert.equal(s.saved, 'off');
    await page.keyboard.press('ArrowUp');
    s = await look();
    assert.deepEqual(s.selected, [true, false]);
    assert.deepEqual(s.button, { state: 'up', visible: true });

    // WITHOUT, then Enter: the title card follows (PRESS START, no choice, no phone button).
    await page.keyboard.press('KeyS');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.cg-choose') && !!document.querySelector('.cg-title canvas'), null, { timeout: 30000 });
    s = await page.evaluate(() => ({
      mode: window.__game.state.mode,
      titleOptions: document.querySelectorAll('.cg-title .cg-opt, .cg-title .cg-c-opt').length,
      phone: !!document.querySelector('.cg-phone'),
      button: window.__game.objects.button.state,
    }));
    assert.deepEqual(s, { mode: 'title', titleOptions: 0, phone: false, button: 'gone' }, 'the Enter that played did not start the game');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__game.state.mode === 'play', null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__game.objects.button.state), 'gone', 'played without the button');

    // Remembered after a reload; a click on an option picks it and plays it.
    await open();
    s = await look();
    assert.deepEqual(s.selected, [false, true], 'WITHOUT is still picked');
    assert.deepEqual(s.button, { state: 'gone', visible: false });
    await page.click('.cg-choose .cg-c-opt >> nth=0');
    await page.waitForFunction(() => !document.querySelector('.cg-choose') && !!document.querySelector('.cg-title canvas'), null, { timeout: 30000 });
    s = await page.evaluate(() => ({ mode: window.__game.state.mode, button: window.__game.objects.button.state, saved: localStorage.getItem('castleGrounds.aiRace.v1') }));
    assert.deepEqual(s, { mode: 'title', button: 'up', saved: 'on' });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
