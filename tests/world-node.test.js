// Integration-owned node tests: the world builders must be importable and runnable in node
// (no canvas) so collision can be unit tested; core/input edge detection; main.js wiring that
// cannot run in node (it needs the DOM) is checked on its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Input } from '../src/core/input.js';
import { GAME_OVER_SECONDS } from '../src/core/constants.js';

test('level builds in node and has a floor at spawn', () => {
  const scene = new THREE.Scene();
  const level = buildLevel(scene);
  const f = level.collision.findFloor(level.spawn.x, level.spawn.y + 100, level.spawn.z);
  assert.ok(f.surface, 'floor under spawn');
  assert.ok(Math.abs(f.y - level.spawn.y) < 30, `floor ${f.y} vs spawn ${level.spawn.y}`);
});

// ---- core/input: short taps between two 30 Hz polls must not be lost -------------------

function keyEvent(type, code) {
  return Object.assign(new Event(type, { cancelable: true }), { code });
}

test('input latches key taps that start and end between two polls', () => {
  const target = new EventTarget();
  const input = new Input(target);
  target.dispatchEvent(keyEvent('keydown', 'Space'));
  target.dispatchEvent(keyEvent('keyup', 'Space'));
  target.dispatchEvent(keyEvent('keydown', 'Escape'));
  target.dispatchEvent(keyEvent('keyup', 'Escape'));
  const c1 = input.poll();
  assert.deepEqual(c1.A, { down: true, pressed: true, released: false });
  assert.equal(c1.START.pressed, true);
  const c2 = input.poll();
  assert.deepEqual(c2.A, { down: false, pressed: false, released: true });
  assert.equal(input.poll().A.released, false);
  input.dispose();
});

test('input: held keys press once; flush() makes a held key not count as a fresh press', () => {
  const target = new EventTarget();
  const input = new Input(target);
  target.dispatchEvent(keyEvent('keydown', 'KeyJ'));
  assert.equal(input.poll().B.pressed, true);
  assert.deepEqual(input.poll().B, { down: true, pressed: false, released: false });
  target.dispatchEvent(keyEvent('keyup', 'KeyJ'));
  target.dispatchEvent(keyEvent('keydown', 'Enter')); // e.g. held through a menu
  input.flush();
  const c = input.poll();
  assert.equal(c.START.down, true);
  assert.equal(c.START.pressed, false);
  // Overrides (test hooks) still behave as held buttons with edge detection.
  input.setOverride({ A: true, stickY: 1 });
  const o = input.poll();
  assert.equal(o.A.pressed, true);
  assert.equal(o.stickY, 1);
  input.setOverride(null);
  assert.equal(input.poll().A.released, true);
  input.dispose();
});

// ---- core/input: gamepads (regression: only the first connected pad was read) ----------

function pad(index, { mapping = 'standard', axes = [0, 0, 0, 0], down = [], timestamp = 0 } = {}) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 }));
  return { index, id: `pad ${index}`, connected: true, mapping, axes, buttons, timestamp };
}

test('input reads the real controller behind an idle or non-standard pad at index 0', () => {
  const input = new Input(new EventTarget());
  // An idle non-standard device (a receiver whose axes rest at -1) ahead of the real pad
  // holding A with the left stick fully up.
  input.getGamepads = () => [pad(0, { mapping: '', axes: [-1, -1, -1, -1], down: [0, 9] }), pad(1, { axes: [0, -1, 0, 0], down: [0] })];
  let c = input.poll();
  assert.ok(c.stickY > 0.99, `stick up read from pad 1 (got ${c.stickY})`);
  assert.equal(c.A.down, true);
  for (const b of ['START', 'CL', 'CU']) assert.equal(c[b].down, false, `non-standard pad ignored for ${b}`);
  // An idle standard pad ahead of it is merged: buttons OR'ed, the pushed stick wins.
  input.getGamepads = () => [null, pad(1, { axes: [0.05, 0.02, 0, 0] }), pad(2, { axes: [0.8, 0, 0, 0], down: [1] })];
  c = input.poll();
  assert.ok(c.stickX > 0.7 && Math.abs(c.stickY) < 1e-9, `stick right from pad 2 (got ${c.stickX}, ${c.stickY})`);
  assert.equal(c.B.pressed, true);
  // sample() latches a flick on the second pad too.
  input.getGamepads = () => [pad(0), pad(1, { down: [5] })];
  input.sample();
  input.getGamepads = () => [pad(0), pad(1)];
  assert.equal(input.poll().R.pressed, true, 'R flick on pad 1 latched between polls');
  // No standard pad: the most recently active non-standard pad is read (in the Switch's own
  // button order: 2 = A, on the right, jumps; see padLayout).
  input.getGamepads = () => [pad(0, { mapping: '', timestamp: 5 }), pad(1, { mapping: '', axes: [0, -1], down: [2], timestamp: 9 })];
  c = input.poll();
  assert.ok(c.stickY > 0.99);
  assert.equal(c.A.down, true);
  input.dispose();
});

// ---- core/input: mouse-drag orbit must end when the button is let go outside the window ---

function mouseEvent(type, props = {}) {
  return Object.assign(new Event(type), { button: 0, buttons: 0, movementX: 0, movementY: 0, ...props });
}

test('input: mouse drag ends on window blur and on moves without a drag button', () => {
  const target = new EventTarget();
  const input = new Input(target);
  target.dispatchEvent(mouseEvent('mousedown', { buttons: 1 }));
  target.dispatchEvent(mouseEvent('mousemove', { buttons: 1, movementX: 40 }));
  assert.equal(input.poll().mouseDX, 40, 'a real drag orbits');
  target.dispatchEvent(new Event('blur')); // e.g. Alt-Tab with the button held
  for (let i = 0; i < 10; i++) target.dispatchEvent(mouseEvent('mousemove', { movementX: 40 }));
  assert.equal(input.poll().mouseDX, 0, 'no orbit after blur');
  // Button released outside the window without a blur: the first button-less move ends it.
  target.dispatchEvent(mouseEvent('mousedown', { button: 2, buttons: 2 }));
  target.dispatchEvent(mouseEvent('mousemove', { buttons: 2, movementY: 10 }));
  target.dispatchEvent(mouseEvent('mousemove', { buttons: 0, movementY: 30 }));
  target.dispatchEvent(mouseEvent('mousemove', { buttons: 0, movementY: 30 }));
  assert.equal(input.poll().mouseDY, 10);
  assert.equal(input.dragging, false);
  input.dispose();
});

// ---- main.js game-over flow (regression: stale world behind the post-GAME-OVER title) ----

const MAIN_SRC = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
// The body of a top-level-in-start() function, up to the next line that closes it.
function fnBody(name) {
  const at = MAIN_SRC.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `main.js has ${name}()`);
  const end = MAIN_SRC.indexOf('\n  }\n', at);
  return MAIN_SRC.slice(at, end);
}

test('main.js resets the world before the title that follows GAME OVER', () => {
  const body = fnBody('gameOver');
  const reset = body.indexOf('objects.reset()');
  const coins = body.indexOf('player.coins = 0');
  const title = body.indexOf('await runTitle()');
  assert.ok(reset >= 0 && coins >= 0 && title >= 0, 'gameOver() resets objects and coins, then shows the title');
  assert.ok(reset < title && coins < title, 'objects.reset() and player.coins = 0 run before the title backdrop is drawn');
  assert.ok(!body.includes('reset?.('), 'ObjectManager.reset() always exists (no optional call)');
  // The card lasts the shared GAME_OVER_SECONDS (audio times its jingle and duck to it).
  assert.ok(/GAME_OVER_SECONDS\s*\*\s*1000/.test(body), 'card length comes from core/constants GAME_OVER_SECONDS');
  assert.ok(!/\b3200\b/.test(MAIN_SRC), 'no second, hard-coded game-over length');
  assert.equal(GAME_OVER_SECONDS, 3.2);
});

test('main.js uses the UI and objects APIs, not their internals', () => {
  assert.ok(MAIN_SRC.includes('new GameOverCard(uiRoot).show()'), 'the GAME OVER card is ui/GameOverCard');
  for (const internal of ['bitmapFont', 'raster', 'hudLogic']) {
    assert.ok(!MAIN_SRC.includes(`./ui/${internal}.js`), `main.js does not import ui/${internal}.js`);
  }
  assert.ok(!MAIN_SRC.includes('style.visibility'), 'HUD visibility goes through hud.setVisible()');
  assert.ok(fnBody('runTitle').includes('hud.setVisible(false)'), 'title hides the HUD');
  assert.ok(fnBody('startGame').includes('hud.setVisible(true)'), 'play shows the HUD');
  // The title backdrop's ambient object clock belongs to ObjectManager (animate -> ambient).
  assert.ok(!fnBody('runTitle').includes('objects.update('), 'the title loop does not tick objects itself');
});

// ---- index.html: an inline tab icon (regression: /favicon.ico 404 and a generic tab icon) --

test('index.html declares an inline SVG favicon', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const m = html.match(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)"/);
  assert.ok(m, 'a <link rel="icon"> with an SVG data URI');
  const svg = decodeURIComponent(m[1]);
  assert.ok(svg.startsWith("<svg xmlns='http://www.w3.org/2000/svg'") && svg.endsWith('</svg>'), 'a complete SVG document');
  assert.ok(!/[<>#"]/.test(m[1]), 'URI-safe (no raw <, >, # or ")');
});
