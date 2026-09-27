// F toggles fullscreen (ui/fullscreen.js): only plain F (no modifiers, no key repeat), only where
// the page can go fullscreen, and Keyboard Lock asks for Esc while fullscreen (so Esc still
// pauses) and lets it go afterwards. The pause legend teaches F. The browser run (E2E=1) checks
// that F in the real game makes the document fullscreen and that the picture fills it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullscreenKey } from '../src/ui/fullscreen.js';
import { KEY_CONTROLS, SMALL_STRINGS } from '../src/ui/hudLogic.js';
import { SMALL_FONT, missingGlyphs } from '../src/ui/bitmapFont.js';

function fakeWindow() {
  const listeners = {};
  const docListeners = {};
  const calls = [];
  const doc = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    documentElement: {
      requestFullscreen(opts) {
        calls.push(['request', opts]);
        doc.fullscreenElement = doc.documentElement;
        return Promise.resolve();
      },
    },
    exitFullscreen() {
      calls.push(['exit']);
      doc.fullscreenElement = null;
      return Promise.resolve();
    },
    addEventListener: (t, fn) => (docListeners[t] = fn),
    removeEventListener: (t) => delete docListeners[t],
  };
  const win = {
    document: doc,
    navigator: {
      keyboard: {
        lock: (keys) => (calls.push(['lock', keys]), Promise.resolve()),
        unlock: () => calls.push(['unlock']),
      },
    },
    addEventListener: (t, fn) => (listeners[t] = fn),
    removeEventListener: (t) => delete listeners[t],
  };
  const key = (init = {}) => listeners.keydown?.({ code: 'KeyF', ...init });
  const change = () => docListeners.fullscreenchange?.();
  return { win, doc, calls, key, change, listeners, docListeners };
}

test('F toggles fullscreen; modified or repeated F and other keys do nothing', async () => {
  const f = fakeWindow();
  const stop = fullscreenKey(f.win);
  f.key({ ctrlKey: true });
  f.key({ metaKey: true });
  f.key({ altKey: true });
  f.key({ repeat: true });
  f.key({ code: 'KeyG' });
  assert.deepEqual(f.calls, []);
  f.key();
  await Promise.resolve();
  assert.deepEqual(f.calls, [['request', { navigationUI: 'hide' }]]);
  assert.equal(f.doc.fullscreenElement, f.doc.documentElement);
  f.key();
  await Promise.resolve();
  assert.deepEqual(f.calls.at(-1), ['exit']);
  assert.equal(f.doc.fullscreenElement, null);
  stop();
  assert.equal(f.listeners.keydown, undefined, 'stop() removes the key listener');
  assert.equal(f.docListeners.fullscreenchange, undefined);
});

test('fullscreen asks Keyboard Lock for Esc and releases it; no fullscreen support: nothing', () => {
  const f = fakeWindow();
  fullscreenKey(f.win);
  f.doc.fullscreenElement = f.doc.documentElement;
  f.change();
  assert.deepEqual(f.calls, [['lock', ['Escape']]]);
  f.doc.fullscreenElement = null;
  f.change();
  assert.deepEqual(f.calls.at(-1), ['unlock']);
  // Browsers without Keyboard Lock (or refusing it) are fine.
  delete f.win.navigator.keyboard;
  f.doc.fullscreenElement = f.doc.documentElement;
  assert.doesNotThrow(() => f.change());
  f.win.navigator.keyboard = { lock: () => Promise.reject(new Error('not in a frame')) };
  assert.doesNotThrow(() => f.change());

  const g = fakeWindow();
  g.doc.fullscreenEnabled = false; // e.g. iPhone Safari
  fullscreenKey(g.win);
  g.key();
  assert.deepEqual(g.calls, []);
  assert.doesNotThrow(() => fullscreenKey(undefined)(), 'no window (node): a no-op');
});

test('the pause legend teaches F and still has twelve rows (it must fit a 4:3 screen)', () => {
  assert.deepEqual(KEY_CONTROLS.find(([k]) => k === 'F'), ['F', 'Fullscreen']);
  assert.equal(KEY_CONTROLS.length, 12);
  for (const s of KEY_CONTROLS.flat()) {
    assert.ok(SMALL_STRINGS.includes(s));
    assert.deepEqual(missingGlyphs(SMALL_FONT, s), [], s);
  }
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

test('F in the game goes fullscreen and back, and the picture fills the screen', { skip, timeout: 300000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${base}/?test=1&mute=1`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
    assert.equal(await page.evaluate(() => !!document.fullscreenElement), false);
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 10000 });
    await page.waitForFunction(() => {
      const vp = window.__game.view.viewport;
      return vp.width === innerWidth && vp.height === innerHeight;
    }, null, { timeout: 10000 });
    const on = await page.evaluate(() => ({ el: document.fullscreenElement === document.documentElement, vp: { ...window.__game.view.viewport }, w: innerWidth, h: innerHeight }));
    assert.equal(on.el, true, 'the whole page is fullscreen');
    assert.deepEqual([on.vp.width, on.vp.height], [on.w, on.h], 'the picture fills it');
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 10000 });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
