// Menu flow in the real game (Vite + headless Chromium, ~30-90 s), opt-in:
//   E2E=1 node --test tests/ui-title.test.js
// The game choice (ui/ChoiceScreen.js) comes first, then the title card.
// Regression for "title music is never heard": browsers start audio only after a user
// gesture, and the Start press that gave it used to begin the game at once (the title
// track was replaced before it was ever heard). Now the press that plays the game choice
// unlocks audio, the title card plays its music and asks for Start, and a fresh Start press
// begins the game. A gamepad press is no gesture: after a pad picks, the card still shows
// PRESS ANY KEY, and a pad Start begins from there.
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

// Logs AudioEngine music calls and, per press, the card's phase, and reports the choice screen,
// the title card and play as they come (console CHOICE_SHOWN / TITLE_SHOWN <phase> / PLAYING);
// `padPresses`: a fake gamepad holds Start from each [screen, ms, holdMs]: that many ms after the
// choice screen ('choice') or the title card ('title') appeared. (Headless Chromium draws few
// frames while the title's logo first renders, longer under load: long holds wait that out.)
function hooks({ padPresses = [] } = {}) {
  window.__log = [];
  const card = () => {
    const el = document.querySelector('.cg-title');
    if (!el) return 'gone';
    return el.classList.contains('cg-out') ? 'fading' : el.classList.contains('cg-locked') ? 'locked' : 'ready';
  };
  window.__card = card;
  const playing = setInterval(() => {
    if (window.__game?.state.mode !== 'play') return;
    clearInterval(playing);
    console.log('PLAYING');
  }, 100);
  window.addEventListener('keydown', (e) => window.__log.push(['keydown', e.code, card()]), true);
  const shownAt = { choice: 0, title: 0 };
  new MutationObserver((_, obs) => {
    if (!document.querySelector('.cg-choose canvas')) return;
    obs.disconnect();
    shownAt.choice = performance.now();
    console.log('CHOICE_SHOWN');
  }).observe(document, { childList: true, subtree: true });
  new MutationObserver((_, obs) => {
    if (!document.querySelector('.cg-title canvas')) return;
    obs.disconnect();
    shownAt.title = performance.now();
    console.log(`TITLE_SHOWN ${card()}`);
  }).observe(document, { childList: true, subtree: true });
  if (padPresses.length) {
    const held = () =>
      padPresses.some(([screen, ms, holdMs]) => {
        const since = performance.now() - shownAt[screen];
        return shownAt[screen] > 0 && since > ms && since < ms + holdMs;
      });
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

// Opens the game at the choice screen; `title` resolves to the title card's phase when it shows.
async function openChoice(query = '', opts = {}) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.addInitScript(hooks, opts);
  const choice = page.waitForEvent('console', { predicate: (m) => m.text() === 'CHOICE_SHOWN', timeout: 180000 });
  const title = page
    .waitForEvent('console', { predicate: (m) => m.text().startsWith('TITLE_SHOWN'), timeout: 240000 })
    .then((m) => m.text().split(' ')[1]);
  await page.goto(`${base}/${query}`, { waitUntil: 'load', timeout: 180000 });
  await choice;
  return { page, title };
}

const state = (page) =>
  page.evaluate(() => ({ log: window.__log, card: window.__card(), mode: window.__game?.state.mode, track: window.__game?.audio.track?.name }));

test('the Enter that plays the choice starts the title music; a second Start press begins the game', { skip, timeout: 240000 }, async () => {
  const { page, title } = await openChoice();
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter', { delay: 80 });
  assert.equal(await title, 'ready', 'that Enter was a gesture: the title card asks for Start, not for any key');
  await page.waitForTimeout(1500);
  let s = await state(page);
  assert.equal(s.mode, 'title', `the Enter that played the choice must not start the game: ${JSON.stringify(s)}`);
  assert.equal(s.card, 'ready');
  assert.equal(s.track, 'title', 'the title music plays');
  assert.ok(s.log.some(([k, n]) => k === 'startMusic' && n === 'title'), JSON.stringify(s.log));
  await page.keyboard.press('Enter', { delay: 80 });
  await page.waitForFunction(() => window.__game?.state.mode === 'play', null, { timeout: 30000 });
  await page.waitForTimeout(500);
  s = await state(page);
  assert.equal(s.track, 'castle_grounds');
  await page.close();
});

test('a gamepad picks the game and begins from the locked card (pad presses cannot unlock audio)', { skip, timeout: 240000 }, async () => {
  // The title press is held until play (a long hold is harmless: the card starts once it is let
  // go or after its 2 s release timeout), so a stall of a few seconds under load cannot miss it.
  const { page, title } = await openChoice('', { padPresses: [['choice', 1500, 2500], ['title', 3000, 60000]] });
  // No page.evaluate before the second pad press (it would unlock): play is reported in the console.
  const playing = page.waitForEvent('console', { predicate: (m) => m.text() === 'PLAYING', timeout: 90000 });
  assert.equal(await title, 'locked', 'no gesture yet: the card asks for any key');
  await playing;
  const s = await state(page);
  assert.equal(s.mode, 'play', JSON.stringify(s));
  await page.close();
});

test('with ?mute=1 there is nothing to unlock: Enter plays the choice, the next Enter begins', { skip, timeout: 240000 }, async () => {
  const { page, title } = await openChoice('?mute=1');
  await page.keyboard.press('Enter', { delay: 80 });
  assert.equal(await title, 'ready');
  await page.keyboard.press('Enter', { delay: 80 });
  await page.waitForFunction(() => window.__game?.state.mode === 'play', null, { timeout: 30000 });
  await page.close();
});
