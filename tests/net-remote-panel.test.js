// The phone-controller panel's pure parts (ui/phoneLogic.js), the pause legend's phone row
// (ui/hudLogic.js phoneEntry, ui/pauseScreen.js) and PhonePanel's DOM-free logic.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BIG_FONT, SMALL_FONT, missingGlyphs, measureText } from '../src/ui/bitmapFont.js';
import {
  PHONE_TITLE,
  PHONE_SCAN,
  PHONE_OPEN,
  PHONE_ROOM,
  PHONE_WAITING,
  PHONE_LINKING,
  PHONE_LINKED,
  PHONE_JOINED,
  PHONE_CLOSE,
  PHONE_BUTTON,
  PHONE_SMALL_STRINGS,
  PHONE_BIG_STRINGS,
  PHONE_ICON,
  QR_QUIET,
  qrMatrix,
  qrModulePx,
  panelLayout,
} from '../src/ui/phoneLogic.js';
import {
  BIG_STRINGS,
  SMALL_STRINGS,
  KEY_CONTROLS,
  PAD_CONTROLS,
  TOUCH_CONTROLS,
  PHONE_CONTROL,
  phoneEntry,
  pauseLayout,
  hudMetrics,
  PAUSE_BOTTOM_MARGIN,
} from '../src/ui/hudLogic.js';
import { controlsLegend, pauseItemRect } from '../src/ui/pauseScreen.js';
import { PhonePanel } from '../src/ui/PhonePanel.js';
import { Events } from '../src/core/events.js';

const URL = 'http://192.168.100.200:5173/pad.html?room=WXYZ';
const measure = (t) => measureText(SMALL_FONT, t);

afterEach(() => {
  phoneEntry.enabled = false;
});

describe('QR code', () => {
  test('encodes a pad URL with the three finder patterns', () => {
    const m = qrMatrix(URL);
    assert.ok(m && m.size >= 21 && (m.size - 17) % 4 === 0, `size ${m?.size}`);
    // Finder patterns: a dark 7x7 ring with a dark 3x3 centre in three corners.
    for (const [ox, oy] of [[0, 0], [m.size - 7, 0], [0, m.size - 7]]) {
      for (let i = 0; i < 7; i++) {
        assert.ok(m.dark(ox + i, oy) && m.dark(ox + i, oy + 6) && m.dark(ox, oy + i) && m.dark(ox + 6, oy + i), 'ring');
      }
      assert.ok(!m.dark(ox + 1, oy + 1) && m.dark(ox + 3, oy + 3), 'gap and centre');
    }
    assert.equal(qrMatrix(''), null);
    assert.equal(qrMatrix('x'.repeat(5000)), null, 'too long: null, no throw');
  });

  test('modules are whole device pixels and fit the box with the quiet zone', () => {
    const m = qrMatrix(URL);
    for (const box of [60, 112, 252, 504, 1000]) {
      const px = qrModulePx(box, m.size);
      assert.ok(Number.isInteger(px) && px >= 1);
      if (px > 1) assert.ok((m.size + 2 * QR_QUIET) * px <= box, `${box}: ${px}`);
    }
    // At the smallest HUD scale on a 960x540 window the modules are still >= 4 device px.
    const { scale } = hudMetrics(960, 540);
    assert.ok(qrModulePx(112 * scale, m.size) >= 4);
  });
});

describe('panel layout and texts', () => {
  test('every text is in the fonts, in the glyph-coverage lists, and trademark free', () => {
    for (const s of PHONE_SMALL_STRINGS) {
      assert.deepEqual(missingGlyphs(SMALL_FONT, s), [], s);
      assert.ok(SMALL_STRINGS.includes(s), s);
    }
    for (const s of PHONE_BIG_STRINGS) {
      assert.deepEqual(missingGlyphs(BIG_FONT, s), [], s);
      assert.ok(BIG_STRINGS.includes(s), s);
    }
    for (const s of PHONE_CONTROL) assert.ok(SMALL_STRINGS.includes(s), s);
    for (const s of [...PHONE_SMALL_STRINGS, ...PHONE_BIG_STRINGS, ...PHONE_CONTROL]) assert.ok(!/n64|nintendo|mario|joy-?con/i.test(s), s);
  });

  test('the panel fits every screen shape and its parts fit the panel', () => {
    for (const [w, h] of [[960, 540], [1920, 1080], [720, 540], [540, 960], [1280, 400], [390, 844]]) {
      const { W, H } = hudMetrics(w, h);
      const L = panelLayout(W, H);
      const P = L.panel;
      const label = `${w}x${h}`;
      assert.ok(P.x >= 0 && P.x + P.w <= W, `${label}: width`);
      assert.ok(P.y >= 0 && P.y + P.h <= H, `${label}: height ${P.y + P.h} of ${H}`);
      for (const k of ['title', 'close', 'scan', 'qr', 'open', 'url', 'roomLabel', 'room', 'status', 'foot']) {
        const r = L[k];
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= P.w + 1e-9 && r.y + r.h <= P.h + 1e-9, `${label}: ${k}`);
      }
      // Texts fit their slots.
      assert.ok(measureText(BIG_FONT, PHONE_TITLE) <= L.close.x - 4, `${label}: title vs close`);
      assert.ok(measure(PHONE_SCAN) <= P.w - 2 * L.pad, `${label}: scan line`);
      assert.ok(measure(PHONE_OPEN) <= L.open.w, `${label}: open line`);
      assert.ok(measure(PHONE_ROOM) <= L.roomLabel.w);
      assert.ok(measureText(BIG_FONT, 'W W W W') * 2 <= L.room.w, `${label}: widest room code`);
      for (const s of [PHONE_WAITING, PHONE_LINKING, PHONE_LINKED]) assert.ok(9 + measure(s) <= L.status.w, `${label}: ${s}`);
      assert.ok(9 + measureText(BIG_FONT, PHONE_JOINED) <= L.status.w, `${label}: joined`);
      assert.ok(measure(PHONE_CLOSE) <= L.foot.w);
      // QR box does not overlap the right-hand column.
      assert.ok(L.qr.x + L.qr.w < L.open.x);
    }
  });

  test('the phone icon is a well-formed palette sprite', () => {
    assert.equal(PHONE_ICON.rows.length, PHONE_ICON.h);
    for (const row of PHONE_ICON.rows) {
      assert.equal(row.length, PHONE_ICON.w);
      for (const ch of row) assert.ok(ch === '.' || PHONE_ICON.palette[ch], `palette ${ch}`);
    }
    assert.ok(measure(PHONE_BUTTON) < 40);
  });
});

describe('pause legend phone row', () => {
  test('shown with the keys and pad legends only while a phone can join', () => {
    assert.equal(controlsLegend('keys'), KEY_CONTROLS);
    assert.equal(pauseItemRect(426, 240, 'keys', PHONE_CONTROL), null);
    phoneEntry.enabled = true;
    assert.equal(controlsLegend('keys').at(-1), PHONE_CONTROL);
    assert.equal(controlsLegend('pad').at(-1), PHONE_CONTROL);
    assert.equal(controlsLegend('touch'), TOUCH_CONTROLS, 'not on the touch screen itself');
    assert.equal(controlsLegend('keys'), controlsLegend('keys'), 'stable array (no churn per repaint)');
    assert.equal(KEY_CONTROLS.includes(PHONE_CONTROL), false, 'the base legend is untouched');
    assert.equal(pauseItemRect(426, 240, 'touch', PHONE_CONTROL), null);
  });

  test('its rect sits inside the legend panel and the stack still fits', () => {
    phoneEntry.enabled = true;
    for (const [W, H] of [[320, 240], [1920 / 4.5, 240], [1280 / 2.5, 400 / 2.5]]) {
      for (const kind of ['keys', 'pad']) {
        const lay = pauseLayout(W, H, measure, controlsLegend(kind));
        const r = pauseItemRect(W, H, kind, PHONE_CONTROL);
        const p = lay.panel;
        const label = `${W.toFixed(0)}x${H.toFixed(0)} ${kind}`;
        assert.ok(r, label);
        assert.ok(r.x >= p.x && r.x + r.w <= p.x + p.w + 1e-9, `${label}: x`);
        assert.ok(r.y >= p.y && r.y + r.h <= p.y + p.h + 1e-9, `${label}: y`);
        assert.ok(lay.top >= 34, `${label}: over the HUD row`);
        if (H >= 240) assert.ok(p.y + p.h <= H, `${label}: on screen`); // (real screens are >= 240 high)
        if (H >= 240 && lay.wide) assert.ok(H - (p.y + p.h) >= PAUSE_BOTTOM_MARGIN - 1e-9, `${label}: bottom margin`);
      }
    }
    // Wide legends: the row fills the empty slot of the right column (the panel does not grow).
    const W = 1920 / 4.5;
    const before = pauseLayout(W, 240, measure, KEY_CONTROLS);
    const after = pauseLayout(W, 240, measure, controlsLegend('keys'));
    assert.equal(after.panel.h, before.panel.h);
  });
});

describe('PhonePanel without a DOM', () => {
  test('the pause legend row follows the relay availability and repaints a pause', () => {
    const events = new Events();
    const remotePad = { available: false, connected: false, status: 'off' };
    const calls = [];
    const hud = { paused: true, setPaused: (p) => calls.push(p) };
    const panel = new PhonePanel(null, { remotePad, events, hud });
    assert.equal(panel.available, false);
    assert.equal(phoneEntry.enabled, false);
    remotePad.available = true;
    events.emit('phonePad', { connected: false, available: true });
    assert.equal(phoneEntry.enabled, true);
    assert.deepEqual(calls, [true], 'the pause screen repaints with the row');
    assert.equal(panel.open(), false, 'no DOM: nothing to open');
    panel.update({ START: { pressed: true }, B: { pressed: false } });
    panel.dispose();
  });
});
