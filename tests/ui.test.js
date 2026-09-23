import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BIG_FONT, SMALL_FONT, missingGlyphs, measureText, glyphOf } from '../src/ui/bitmapFont.js';
import { ICONS } from '../src/ui/icons.js';
import { PowerMeterLogic, METER_HIDE_DELAY, meterPaletteName, isLowHealth } from '../src/ui/powerMeter.js';
import {
  hudMetrics,
  boxStyle,
  MeterSlide,
  RollingCounter,
  bumpCurve,
  redCoinCurve,
  legendLayout,
  pauseLayout,
  PAUSE_BOTTOM_MARGIN,
  KEY_CONTROLS,
  PAD_CONTROLS,
  BIG_STRINGS,
  SMALL_STRINGS,
} from '../src/ui/hudLogic.js';
import { HUD } from '../src/ui/HUD.js';
import { Events } from '../src/core/events.js';

const TICK = 1 / 30;

test('fonts cover every string the UI draws', () => {
  for (const s of BIG_STRINGS) assert.deepEqual(missingGlyphs(BIG_FONT, s), [], `big font: ${s}`);
  for (const s of SMALL_STRINGS) assert.deepEqual(missingGlyphs(SMALL_FONT, s), [], `small font: ${s}`);
  for (let d = 0; d <= 9; d++) assert.ok(glyphOf(BIG_FONT, String(d)), `digit ${d}`);
  // The big font has no lowercase; letters are upper-cased on lookup.
  assert.equal(glyphOf(BIG_FONT, 'p'), glyphOf(BIG_FONT, 'P'));
});

test('glyph bitmaps are well-formed', () => {
  for (const font of [BIG_FONT, SMALL_FONT]) {
    for (const [ch, g] of Object.entries(font.glyphs)) {
      assert.ok(g.rows.length <= font.height, `${font.name} '${ch}' too tall`);
      for (const row of g.rows) assert.equal(row.length, g.w, `${font.name} '${ch}' ragged row`);
      assert.equal(g.bits.length, g.w * font.height);
    }
    // Digits fit the fixed counter cell so numbers never jitter.
    for (let d = 0; d <= 9; d++) assert.ok(font.glyphs[String(d)].w <= font.digitWidth);
  }
  assert.equal(measureText(BIG_FONT, 'PAUSE'), 8 * 5 + 4);
});

test('icons are square pixel art with a palette colour for every pixel', () => {
  for (const [name, icon] of Object.entries(ICONS)) {
    assert.equal(icon.rows.length, icon.h, name);
    for (const row of icon.rows) {
      assert.equal(row.length, icon.w, name);
      for (const c of row) if (c !== '.') assert.ok(icon.palette[c], `${name}: no colour for '${c}'`);
    }
  }
});

test('power meter stays hidden at full health and drops in on damage', () => {
  const m = new PowerMeterLogic();
  for (let i = 0; i < 90; i++) m.tick({ health: 8 }, TICK);
  assert.equal(m.visible, false);
  m.tick({ health: 6 }, TICK);
  assert.equal(m.visible, true);
  // Stays while health is missing, however long.
  for (let i = 0; i < 300; i++) m.tick({ health: 6 }, TICK);
  assert.equal(m.visible, true);
});

test('power meter slides away ~2 s after health is full again, not before', () => {
  const m = new PowerMeterLogic();
  m.tick({ health: 8 }, TICK);
  m.tick({ health: 7 }, TICK);
  m.tick({ health: 8 }, TICK); // healed: the change itself keeps it up
  const ticks = Math.round(METER_HIDE_DELAY / TICK);
  for (let i = 0; i < ticks - 2; i++) m.tick({ health: 8 }, TICK);
  assert.equal(m.visible, true, 'still visible just before the delay');
  for (let i = 0; i < 3; i++) m.tick({ health: 8 }, TICK);
  assert.equal(m.visible, false, 'hidden after the delay');
});

test('power meter stays up in water (showPower) even at full health', () => {
  const m = new PowerMeterLogic();
  m.tick({ health: 8, showPower: true }, TICK);
  for (let i = 0; i < 200; i++) m.tick({ health: 8, showPower: true }, TICK);
  assert.equal(m.visible, true);
  // Leaving the water starts the hide timer.
  for (let i = 0; i < Math.round(METER_HIDE_DELAY / TICK) + 1; i++) m.tick({ health: 8, showPower: false }, TICK);
  assert.equal(m.visible, false);
  // Breath below full also keeps it visible.
  m.tick({ health: 8, breath: 0.5 }, TICK);
  assert.equal(m.visible, true);
});

test('displayed wedges step towards the real health one at a time', () => {
  const m = new PowerMeterLogic();
  m.tick({ health: 8 }, TICK);
  m.tick({ health: 5 }, TICK);
  const seen = [m.displayHealth];
  for (let i = 0; i < 20; i++) {
    m.tick({ health: 5 }, TICK);
    seen.push(m.displayHealth);
  }
  assert.equal(seen.at(-1), 5);
  for (let i = 1; i < seen.length; i++) assert.ok(Math.abs(seen[i] - seen[i - 1]) <= 1);
});

test('meter colours follow health: blue, green, yellow, red', () => {
  assert.equal(meterPaletteName(8), 'blue');
  assert.equal(meterPaletteName(7), 'blue');
  assert.equal(meterPaletteName(6), 'green');
  assert.equal(meterPaletteName(5), 'green');
  assert.equal(meterPaletteName(4), 'yellow');
  assert.equal(meterPaletteName(3), 'yellow');
  assert.equal(meterPaletteName(2), 'red');
  assert.equal(meterPaletteName(1), 'red');
  assert.ok(isLowHealth(1) && isLowHealth(2) && !isLowHealth(3) && !isLowHealth(0));
});

test('HUD scales from a 320x240 grid by height, or by width on narrow screens', () => {
  assert.deepEqual(hudMetrics(1920, 1080), { scale: 4.5, W: 1920 / 4.5, H: 240 });
  assert.equal(hudMetrics(960, 540).scale, 2.25);
  const tall = hudMetrics(640, 1200);
  assert.equal(tall.scale, 2);
  assert.equal(tall.W, 320);
});

test('coin counter rolls up one per tick and snaps down', () => {
  const c = new RollingCounter(0);
  assert.equal(c.tick(3), true);
  assert.equal(c.tick(3), true);
  assert.equal(c.tick(3), true);
  assert.equal(c.shown, 3);
  assert.equal(c.tick(3), false);
  assert.equal(c.tick(0), false);
  assert.equal(c.shown, 0);
});

test('bump and red-coin curves start and settle', () => {
  assert.deepEqual(bumpCurve(-1), { hop: 0, scale: 1 });
  assert.ok(bumpCurve(0.1).scale > 1);
  assert.deepEqual(bumpCurve(1), { hop: 0, scale: 1 });
  assert.equal(redCoinCurve(-0.01), null);
  assert.ok(redCoinCurve(0.1).scale > 0);
  assert.equal(redCoinCurve(0.6).alpha, 1);
  assert.ok(redCoinCurve(1.4).alpha < 0.5);
  assert.equal(redCoinCurve(2), null);
});

test('controls legend uses two columns when wide, one when narrow', () => {
  const measure = (t) => measureText(SMALL_FONT, t);
  const wide = legendLayout(427, measure);
  assert.equal(wide.columns.length, 2);
  assert.ok(wide.width <= 427 - 40);
  const narrow = legendLayout(320, measure);
  assert.equal(narrow.columns.length, 1);
  assert.equal(narrow.rows, KEY_CONTROLS.length);
  const pad = legendLayout(320, measure, PAD_CONTROLS);
  assert.equal(pad.rows, PAD_CONTROLS.length);
});

test('pause stack keeps clear of the bottom edge and the HUD row at every aspect', () => {
  const measure = (t) => measureText(SMALL_FONT, t);
  // 4:3 pillarbox and 16:9, keyboard and gamepad legends, plus a short wide window.
  for (const [W, H] of [[320, 240], [1920 / 4.5, 240], [1280 / 2.5, 400 / 2.5]]) {
    for (const controls of [KEY_CONTROLS, PAD_CONTROLS]) {
      const lay = pauseLayout(W, H, measure, controls);
      const bottom = lay.panel.y + lay.panel.h;
      const label = `${W.toFixed(0)}x${H.toFixed(0)} ${controls === PAD_CONTROLS ? 'pad' : 'keys'}`;
      assert.ok(lay.top >= 34, `${label}: over the HUD row`);
      if (H >= 240) assert.ok(H - bottom >= PAUSE_BOTTOM_MARGIN - 1e-9, `${label}: ${H - bottom} px from the bottom`);
      assert.ok(lay.panel.x >= 0 && lay.panel.x + lay.panel.w <= W, `${label}: panel wider than the screen`);
    }
  }
});

test('HUD logic runs without a DOM and pops red coins from events', () => {
  const events = new Events();
  const hud = new HUD(null, { events });
  hud.update({ lives: 4, coins: 0, stars: 0, health: 8, showPower: false });
  events.emit('coin', { value: 2, red: true, index: 5 });
  assert.equal(hud.redPopup.n, 5);
  events.emit('coin', { value: 2, red: true }); // no index: count on from the last one
  assert.equal(hud.redPopup.n, 6);
  events.emit('coin', { value: 1, red: false });
  assert.equal(hud.redPopup.n, 6);
  hud.update({ coins: 2, health: 7 });
  assert.equal(hud.coinCounter.shown, 1);
  assert.equal(hud.meter.visible, true);
  hud.dispose();
  // Old call style without options still works.
  assert.doesNotThrow(() => new HUD(null).update({ lives: 1, coins: 0, stars: 0, health: 8 }));
});

test('meter slide stays continuous when it reverses mid-way', () => {
  const dt = 1 / 60;
  // Largest per-frame move of the eased position over a sequence of shown/hidden phases.
  const maxStep = (phases) => {
    const slide = new MeterSlide(0.4);
    let prev = slide.drop;
    let max = 0;
    for (const [visible, frames] of phases) {
      for (let i = 0; i < frames; i++) {
        slide.step(visible, dt);
        max = Math.max(max, Math.abs(slide.drop - prev));
        prev = slide.drop;
      }
    }
    return { slide, max };
  };
  const plain = maxStep([[true, 40]]); // one normal drop-in: the curve's own top speed
  assert.equal(plain.slide.t, 1);
  assert.equal(plain.slide.drop, 1);
  // In, half-way out, back in (damage during the slide-out), then out again.
  const { slide, max } = maxStep([[true, 40], [false, 12], [true, 6], [false, 40]]);
  assert.equal(slide.t, 0);
  assert.equal(slide.drop, 0);
  assert.ok(max <= plain.max + 1e-9, `reversal jumped ${max} (normal top speed ${plain.max})`);
  assert.equal(slide.step(false, dt), false, 'settled');
});

test('HUD follows the paused field of update() as well as setPaused()', () => {
  const hud = new HUD(null);
  hud.update({ lives: 4, coins: 0, stars: 0, health: 8, paused: true });
  assert.equal(hud.paused, true);
  hud.update({ lives: 4, coins: 0, stars: 0, health: 8 }); // no field: unchanged
  assert.equal(hud.paused, true);
  hud.update({ paused: false });
  assert.equal(hud.paused, false);
  hud.setPaused(true);
  assert.equal(hud.paused, true);
});

test('overlay box follows the picture viewport', () => {
  assert.deepEqual(boxStyle({ x: 120, y: 0, width: 720, height: 540 }), {
    left: '120px',
    top: '0px',
    width: '720px',
    height: '540px',
  });
  assert.deepEqual(boxStyle(null), { left: '0', top: '0', width: '100%', height: '100%' });
});

test('controls legends name every key and gamepad binding family', () => {
  const keys = KEY_CONTROLS.map(([k]) => k).join(' ');
  for (const k of ['WASD', 'Q', 'Space', 'K', 'J', 'Shift', 'L', 'Arrow', 'C', 'Esc', 'Enter', 'F2', 'F3']) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
  // Standard-mapping pad bindings from core/input.js.
  const pad = PAD_CONTROLS.map(([k]) => k).join(' ');
  for (const k of ['Left stick', 'A', 'B', 'X', 'LB', 'LT', 'RT', 'RB', 'Right stick', 'D-pad', 'Start']) {
    assert.ok(pad.includes(k), `missing pad ${k}`);
  }
});

test('red-coin number and counter bumps freeze while paused', () => {
  const events = new Events();
  const hud = new HUD(null, { events });
  hud.update({ lives: 4, coins: 0, stars: 0, health: 8 });
  hud.update({ coins: 1 });
  events.emit('coin', { value: 2, red: true, index: 1 });
  hud._animate(0.5);
  hud.setPaused(true);
  // A long pause does not use up the number's screen time...
  for (let i = 0; i < 300; i++) hud._animate(1 / 60);
  assert.equal(hud.redPopup?.n, 1);
  assert.equal(hud.redPopup.age, 0.5);
  assert.ok(hud.bumps.coins < 0.5 + 1e-9);
  // ...which resumes after unpausing and then runs out.
  hud.setPaused(false);
  for (let i = 0; i < 120; i++) hud._animate(1 / 60);
  assert.equal(hud.redPopup, null);
  hud.dispose();
});
