// Title-card flow in the real game (Vite + headless Chromium, ~30-90 s), opt-in:
//   E2E=1 node --test tests/ui-title.test.js
// Regression for "title music is never heard": browsers start audio only after a user
// gesture, and the Start press that gave it used to begin the game at once (the title
// track was replaced before it was ever heard). Now the first press only unlocks audio and
// starts the title music; a fresh Start press begins the game.
//
// Nothing may be evaluated in the page before the first real press: Playwright's
// page.evaluate() (and page.screenshot()/waitForSelector()) count as a user gesture.
// The hooks therefore go in an init script and the title is detected via a console line.
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
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'],
  });
}, { timeout: 120000 });

after(async () => {
  await browser?.close();
  await server?.close();
});

// Logs AudioEngine music calls and, per press, the card's phase; `padStartMs`: a fake
// gamepad holds Start from that many ms after the title appears, for 700 ms (and again from
// `padAgainMs`, for the face screen that follows the title).
function hooks({ padStartMs = 0, padAgainMs = 0 } = {}) {
  window.__log = [];
  const card = () => {
    const el = document.querySelector('.cg-title');
    if (!el) return 'gone';
    return el.classList.contains('cg-out') ? 'fading' : el.classList.contains('cg-locked') ? 'locked' : 'ready';
  };
  window.__card = card;
  window.addEventListener('keydown', (e) => window.__log.push(['keydown', e.code, card()]), true);
  let shownAt = 0;
  new MutationObserver((_, obs) => {
    if (!document.querySelector('.cg-title canvas')) return;
    obs.disconnect();
    shownAt = performance.now();
    console.log(`TITLE_SHOWN ${card()}`);
  }).observe(document, { childList: true, subtree: true });
  if (padStartMs) {
    const within = (from) => from > 0 && performance.now() - shownAt > from && performance.now() - shownAt < from + 700;
    const held = () => shownAt > 0 && (within(padStartMs) || within(padAgainMs));
    navigator.getGamepads = () => [
      { index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 9 && held(), value: 0 })) },
    ];
  }
  import('/src/audio/AudioEngine.js').then(({ AudioEngine }) => {
    const P = AudioEngine.prototype;
    for (const k of ['playMusic', 'startMusic']) {
      const orig = P[k];
      P[k] = function (name) {
        window.__log.push([k, name, card()]);
        return orig.call(this, name);
      };
    }
  });
}

async function openTitle(query = '', opts = {}) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.addInitScript(hooks, opts);
  const shown = page.waitForEvent('console', { predicate: (m) => m.text().startsWith('TITLE_SHOWN'), timeout: 180000 });
  await page.goto(`${base}/${query}`, { waitUntil: 'load', timeout: 180000 });
  const phase = (await shown).text().split(' ')[1];
  return { page, phase };
}

const state = (page) =>
  page.evaluate(() => ({ log: window.__log, card: window.__card(), mode: window.__game?.state.mode, track: window.__game?.audio.track?.name }));

test('first press starts the title music; a second Start press begins the game', { skip, timeout: 240000 }, async () => {
  const { page, phase } = await openTitle();
  assert.equal(phase, 'locked', 'before any gesture the card asks for any key');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter', { delay: 80 });
  await page.waitForTimeout(1500);
  let s = await state(page);
  assert.equal(s.mode, 'title', `the unlocking Enter must not start the game: ${JSON.stringify(s)}`);
  assert.equal(s.card, 'ready', 'PRESS START shows once audio is unlocked');
  assert.equal(s.track, 'title', 'the title music plays');
  assert.ok(s.log.some(([k, n]) => k === 'startMusic' && n === 'title'), JSON.stringify(s.log));
  await page.keyboard.press('Enter', { delay: 80 });
  // The face screen (ui/FaceScreen.js) comes next, the title music playing on; Start again plays.
  await page.waitForFunction(() => window.__game?.state.mode === 'face' && window.__game.face?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  s = await state(page);
  assert.equal(s.track, 'title', 'the title music plays on over the face screen');
  await page.keyboard.press('Enter', { delay: 80 });
  await page.waitForFunction(() => window.__game?.state.mode === 'play', null, { timeout: 30000 });
  await page.waitForTimeout(500);
  s = await state(page);
  assert.equal(s.track, 'castle_grounds');
  await page.close();
});

test('a gamepad Start begins from the locked card (pad presses cannot unlock audio)', { skip, timeout: 240000 }, async () => {
  const { page, phase } = await openTitle('', { padStartMs: 1500, padAgainMs: 8000 });
  assert.equal(phase, 'locked');
  await page.waitForTimeout(4000); // no page.evaluate before the pad press: it would unlock
  const s = await state(page);
  assert.equal(s.mode, 'face', JSON.stringify(s));
  // The pad's second Start leaves the face screen for play.
  await page.waitForFunction(() => window.__game?.state.mode === 'play', null, { timeout: 30000 });
  await page.close();
});

test('with ?mute=1 there is nothing to unlock: the first Start press begins', { skip, timeout: 240000 }, async () => {
  const { page, phase } = await openTitle('?mute=1');
  assert.equal(phase, 'ready');
  await page.keyboard.press('Enter', { delay: 80 });
  await page.waitForFunction(() => window.__game?.state.mode === 'face' && window.__game.face?.ready, null, { timeout: 60000 });
  await page.keyboard.press('Enter', { delay: 80 });
  await page.waitForFunction(() => window.__game?.state.mode === 'play', null, { timeout: 30000 });
  await page.close();
});
