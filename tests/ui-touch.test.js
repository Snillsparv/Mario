// Touch controller (src/ui/touchLogic.js, src/ui/TouchController.js): stick and D-pad math,
// the portrait / landscape layouts, hit-testing, the touch-to-controller logic, and the
// title / pause texts for touch screens. The browser part (real touch events moving Pip) runs
// with E2E=1 (Vite + headless Chromium, ~1-2 min).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stickVector,
  dpadVector,
  touchLayout,
  touchRole,
  buttonAt,
  slidePresses,
  inWell,
  shapeDistance,
  wantTouchUi,
  portraitHeight,
  touchUi,
  TOUCH_BUTTONS,
  STICK_DEADZONE,
  STICK_FULL,
  PORTRAIT_SHARE,
  HUD_ROW_BOTTOM,
} from '../src/ui/touchLogic.js';
import { TouchController } from '../src/ui/TouchController.js';
import { Events } from '../src/core/events.js';
import { Input } from '../src/core/input.js';
import { BIG_FONT, SMALL_FONT, measureText } from '../src/ui/bitmapFont.js';
import {
  TOUCH_CONTROLS,
  TOUCH_START_PROMPT,
  TOUCH_UNLOCK_PRESS,
  TOUCH_UNLOCK_PROMPT,
  TOUCH_TITLE_HINT,
  BIG_STRINGS,
  SMALL_STRINGS,
  pauseLayout,
  hudMetrics,
} from '../src/ui/hudLogic.js';
import { controlsLegend } from '../src/ui/pauseScreen.js';
import { HUD } from '../src/ui/HUD.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

describe('thumb stick math', () => {
  test('dead zone, then magnitude grows with the distance up to full', () => {
    const t = 40;
    assert.equal(stickVector(0, 0, t).mag, 0);
    assert.equal(stickVector(t * STICK_DEADZONE * 0.9, 0, t).mag, 0, 'inside the dead zone');
    const half = stickVector(t * (STICK_DEADZONE + (STICK_FULL - STICK_DEADZONE) / 2), 0, t);
    assert.ok(near(half.mag, 0.5), `half way: ${half.mag}`);
    assert.equal(stickVector(t * STICK_FULL, 0, t).mag, 1, 'full before the rim');
    assert.equal(stickVector(t * 3, 0, t).mag, 1, 'clamped past the rim');
    let prev = 0;
    for (let d = 0; d <= t; d += 2) {
      const m = stickVector(0, d, t).mag;
      assert.ok(m >= prev, 'monotonic');
      prev = m;
    }
  });

  test('screen y down is stick y up; the direction is kept', () => {
    const up = stickVector(0, -40, 40);
    assert.ok(near(up.x, 0) && near(up.y, 1));
    const right = stickVector(40, 0, 40);
    assert.ok(near(right.x, 1) && near(right.y, 0));
    const diag = stickVector(30, 30, 40);
    assert.ok(near(diag.x, -diag.y), 'down-right');
    assert.ok(near(Math.hypot(diag.x, diag.y), diag.mag));
  });

  test('the knob follows the thumb but stays inside its travel', () => {
    const a = stickVector(10, -5, 40);
    assert.equal(a.kx, 10);
    assert.equal(a.ky, -5);
    const b = stickVector(-300, 400, 40);
    assert.ok(near(Math.hypot(b.kx, b.ky), 40));
    assert.ok(near(b.kx / b.ky, -300 / 400));
  });

  test('fills the given object (no allocation per touchmove)', () => {
    const out = { x: 0, y: 0, mag: 0, kx: 0, ky: 0 };
    assert.equal(stickVector(20, 0, 40, out), out);
    assert.equal(dpadVector(20, 0, 40, out), out);
  });
});

describe('D-pad', () => {
  test('eight directions, diagonals normalised, a small dead centre', () => {
    const h = 40;
    const dirs = [
      [30, 0, 1, 0],
      [30, -30, Math.SQRT1_2, Math.SQRT1_2],
      [0, -30, 0, 1],
      [-30, -30, -Math.SQRT1_2, Math.SQRT1_2],
      [-30, 0, -1, 0],
      [-30, 30, -Math.SQRT1_2, -Math.SQRT1_2],
      [0, 30, 0, -1],
      [30, 30, Math.SQRT1_2, -Math.SQRT1_2],
    ];
    for (const [dx, dy, x, y] of dirs) {
      const v = dpadVector(dx, dy, h);
      assert.ok(near(v.x, x) && near(v.y, y), `${dx},${dy} -> ${v.x},${v.y}`);
      assert.equal(v.mag, 1);
    }
    const v = dpadVector(30, -8, h); // mostly right
    assert.equal(v.right && !v.up && !v.down, true);
    assert.equal(dpadVector(2, 2, h).mag, 0, 'centre');
    const ul = dpadVector(-20, -20, h);
    assert.equal(ul.up && ul.left && !ul.down && !ul.right, true);
  });
});

// Phone and tablet windows (CSS px), with and without a home-indicator / notch inset.
const PORTRAITS = [
  [360, 640],
  [375, 667],
  [390, 844],
  [430, 932],
  [360, 780],
  [768, 1024],
];
const LANDSCAPES = [
  [640, 360],
  [667, 375],
  [844, 390],
  [932, 430],
  [1024, 768],
];

function overlaps(a, b, gap) {
  // Two shapes (circles/pills) closer than `gap` px edge to edge: sample a's outline.
  const pts = [];
  if (a.kind === 'circle') for (let i = 0; i < 32; i++) pts.push([a.x + Math.cos((i / 32) * 2 * Math.PI) * a.r, a.y + Math.sin((i / 32) * 2 * Math.PI) * a.r]);
  else {
    const r = (a.rot * Math.PI) / 180;
    for (let i = 0; i <= 16; i++) {
      for (const side of [-1, 1]) {
        const lx = (i / 16 - 0.5) * a.w;
        const ly = (side * a.h) / 2;
        pts.push([a.x + lx * Math.cos(r) - ly * Math.sin(r), a.y + lx * Math.sin(r) + ly * Math.cos(r)]);
      }
    }
  }
  return pts.some(([x, y]) => shapeDistance(b, x, y) < gap);
}

function checkControls(L, safe, W, H) {
  const names = Object.keys(L.buttons);
  assert.deepEqual(names.sort(), [...TOUCH_BUTTONS].sort());
  for (const n of names) {
    const b = L.buttons[n];
    const ext = b.kind === 'circle' ? b.r : b.w / 2;
    assert.ok(b.x - ext >= safe.left - 1 && b.x + ext <= W - safe.right + 1, `${n} inside the width (${W}x${H})`);
    assert.ok(b.y - ext >= 0 && b.y + (b.kind === 'circle' ? b.r : b.h) <= H - safe.bottom + 1, `${n} above the bottom inset (${W}x${H})`);
    assert.equal(buttonAt(L, b.x, b.y), n, `${n} hit at its centre (${W}x${H})`);
    assert.ok(touchRole(L, b.x, b.y) === n);
    for (const m of names) if (m < n) assert.ok(!overlaps(L.buttons[m], b, 1), `${m} and ${n} apart (${W}x${H})`);
    // No button sits on the stick well or the D-pad.
    assert.ok(Math.hypot(b.x - L.stick.x, b.y - L.stick.y) > L.stick.well, `${n} off the stick`);
    assert.ok(Math.abs(b.x - L.dpad.x) > L.dpad.size / 2 || Math.abs(b.y - L.dpad.y) > L.dpad.size / 2, `${n} off the D-pad`);
  }
  // Big, thumb-sized main buttons (>= ~44 px targets at phone sizes).
  assert.ok(L.buttons.A.r * 2 >= 44 && L.buttons.B.r * 2 >= 36, `A ${L.buttons.A.r * 2}px`);
  assert.ok(L.stick.x < W / 2 && L.dpad.x < W / 2, 'stick and D-pad on the left');
  for (const n of ['A', 'B', 'Z', 'CU', 'CD', 'CL', 'CR']) assert.ok(L.buttons[n].x > W / 2, `${n} on the right`);
  assert.equal(touchRole(L, L.stick.x, L.stick.y), 'stick');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI; // the whole well grabs the stick, rim included
    const r = touchRole(L, L.stick.x + Math.cos(a) * L.stick.well * 0.95, L.stick.y + Math.sin(a) * L.stick.well * 0.95);
    assert.equal(r, 'stick', `well rim at ${i * 45} deg (${W}x${H})`);
  }
  assert.equal(touchRole(L, L.dpad.x, L.dpad.y), 'dpad');
  assert.ok(inWell(L, L.stick.x + L.stick.well * 0.9, L.stick.y));
}

describe('layout', () => {
  test('portrait: the picture keeps the top ~58%, the body fills the bottom', () => {
    for (const [W, H] of PORTRAITS) {
      for (const safe of [{}, { bottom: 34, top: 47 }]) {
        const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
        const L = touchLayout(W, H, s);
        assert.equal(L.mode, 'portrait');
        assert.equal(L.pictureBottom, portraitHeight(W, H));
        const share = L.pictureBottom / H;
        assert.ok(share >= 0.38 && share <= 0.46, `${W}x${H}: controller ${share}`);
        assert.ok(Math.abs(PORTRAIT_SHARE - share) < 0.05);
        assert.equal(L.top, H - L.pictureBottom);
        assert.deepEqual(L.body, { ...L.body, x: 0, y: L.top, w: W, h: L.pictureBottom });
        for (const b of Object.values(L.buttons)) assert.ok(b.y - (b.r ?? 0) > L.top, 'controls on the body, not the picture');
        assert.ok(L.stick.y - L.stick.well > L.top);
        checkControls(L, s, W, H);
        // START and CAM in the middle column.
        assert.ok(near(L.buttons.START.x, W / 2) && near(L.buttons.R.x, W / 2));
        // A touch on the picture is not the controller's; the whole body is.
        assert.equal(touchRole(L, W / 2, L.top / 2), null);
        assert.notEqual(touchRole(L, 4, H - 4), null);
        // The left half (off the D-pad) starts the stick anywhere.
        assert.equal(touchRole(L, 12, L.stick.y + L.stick.well * 0.5), 'stick');
      }
    }
  });

  test('landscape: controls float over the picture corners; the middle stays free', () => {
    for (const [W, H] of LANDSCAPES) {
      for (const safe of [{}, { left: 47, right: 47, bottom: 21 }]) {
        const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
        const L = touchLayout(W, H, s);
        assert.equal(L.mode, 'landscape');
        assert.equal(L.pictureBottom, 0, 'the picture fills the screen');
        assert.equal(L.body, null);
        checkControls(L, s, W, H);
        assert.ok(L.stick.y > H / 2 && L.buttons.A.y > H / 2, 'stick and A in the lower corners');
        for (const n of ['START', 'CU']) assert.ok(L.buttons[n].y < H * 0.4, `${n} near the top edge`);
        // Below the HUD's counter row (lives left, coins and stars right), at any HUD scale.
        const hudRow = HUD_ROW_BOTTOM * hudMetrics(W, H).scale;
        for (const n of ['START', 'R', 'CU']) {
          const b = L.buttons[n];
          assert.ok(b.y - (b.kind === 'circle' ? b.r : b.h / 2) >= hudRow + s.top, `${n} under the HUD row (${W}x${H})`);
        }
        // Every control is inside a touch zone; the picture's centre is not.
        for (const [n, b] of Object.entries(L.buttons)) assert.ok(touchRole(L, b.x, b.y) === n);
        assert.equal(touchRole(L, W / 2, H / 2), null);
        // Floating stick: anywhere in the lower left.
        const fx = L.stickZone.x + L.stickZone.w * 0.9;
        const fy = L.stickZone.y + L.stickZone.h * 0.2;
        assert.equal(touchRole(L, fx, fy), 'stick');
        assert.equal(inWell(L, fx, fy), false);
        assert.ok(L.stickZone.w >= W * 0.35 && L.stickZone.y <= H * 0.3);
      }
    }
  });

  test('portrait: START and CAM keep well clear of the play buttons (no pause by a drifting thumb)', () => {
    for (const [W, H] of [[320, 568], ...PORTRAITS]) {
      for (const safe of [{}, { bottom: 34 }]) {
        const L = touchLayout(W, H, safe);
        const k = L.k;
        for (const sys of ['START', 'R']) {
          for (const play of ['A', 'B', 'Z']) {
            const a = L.buttons[sys];
            const b = L.buttons[play];
            // Edge-to-edge gap wider than both hit slacks together.
            const gap = 22 * k;
            assert.ok(!overlaps(a, b, gap), `${sys}-${play} under ${gap.toFixed(1)} px apart (${W}x${H})`);
          }
        }
        // A thumb landing just off ATTACK's rim toward START still reads ATTACK.
        const { B, START } = L.buttons;
        const d = Math.hypot(START.x - B.x, START.y - B.y);
        for (const off of [2, 7]) {
          const x = B.x + ((START.x - B.x) / d) * (B.r + off * k);
          const y = B.y + ((START.y - B.y) / d) * (B.r + off * k);
          assert.equal(buttonAt(L, x, y), 'B', `${off}px off B toward START (${W}x${H})`);
        }
      }
    }
  });

  test('system buttons lose a near tie against a play button', () => {
    const L = touchLayout(390, 844, {});
    // Squeeze START next to B: a point equally far from both edges goes to B.
    const B = L.buttons.B;
    const S = { ...L.buttons.START, x: B.x - B.r - 6 - L.buttons.START.w / 2, y: B.y };
    const squeezed = { ...L, buttons: { ...L.buttons, START: S } };
    // 4 px off B's rim, 2 px off START's: B wins (START ranks 6 px farther).
    assert.equal(buttonAt(squeezed, B.x - B.r - 4, B.y), 'B');
    assert.equal(buttonAt(squeezed, S.x, S.y), 'START', 'START itself still hits');
    assert.equal(slidePresses('B', 'START'), false);
    assert.equal(slidePresses(null, 'R'), false);
    assert.equal(slidePresses('START', 'START'), true);
    assert.equal(slidePresses('Z', 'A'), true);
  });

  test('hit slack: a near miss still presses the button; far away nothing', () => {
    const L = touchLayout(390, 844, {});
    const A = L.buttons.A;
    assert.equal(buttonAt(L, A.x + A.r + 6, A.y), 'A', 'just outside the rim');
    assert.equal(buttonAt(L, A.x + A.r + 40, A.y), null);
    const C = L.buttons.CL;
    assert.equal(buttonAt(L, C.x - C.r - 4, C.y), 'CL');
  });
});

test('shown on coarse pointers or ?touch=1; ?touch=0 never', () => {
  assert.equal(wantTouchUi({ search: '', coarse: false }), false);
  assert.equal(wantTouchUi({ search: '', coarse: true }), true);
  assert.equal(wantTouchUi({ search: '?touch=1', coarse: false }), true);
  assert.equal(wantTouchUi({ search: '?test=1&touch', coarse: false }), true);
  assert.equal(wantTouchUi({ search: '?touch=0', coarse: true }), false);
});

// The controller's touch logic without a DOM (node): a stand-in input records the states.
function rig(W = 390, H = 844) {
  const events = new Events();
  const sent = [];
  const input = { setTouchState: (st) => sent.push({ ...st }), addLookDelta() {} };
  const tc = new TouchController({ input, events });
  tc.layout = touchLayout(W, H, {});
  tc.shown = true;
  const log = [];
  events.on('touchPress', (e) => log.push(['press', e.button, e.picture]));
  events.on('touchRelease', (e) => log.push(['release', e.button]));
  return { tc, L: tc.layout, sent, last: () => sent[sent.length - 1], log };
}

describe('touch controller logic', () => {
  test('is inert without a DOM until laid out', () => {
    const tc = new TouchController({});
    assert.equal(tc.shown, false);
    assert.doesNotThrow(() => tc._pointer('start', 1, 10, 10));
    assert.doesNotThrow(() => tc.releaseAll());
  });

  test('stick drag from the well pushes the stick; release centres it', () => {
    const { tc, L, last, log } = rig();
    tc._pointer('start', 1, L.stick.x, L.stick.y);
    assert.equal(last().stickY, 0);
    tc._pointer('move', 1, L.stick.x, L.stick.y - L.stick.travel);
    assert.equal(last().stickY, 1);
    assert.ok(near(last().stickX, 0));
    tc._pointer('move', 1, L.stick.x + L.stick.travel * 0.4, L.stick.y);
    assert.ok(last().stickX > 0.2 && last().stickX < 0.5, `partial push ${last().stickX}`);
    tc._pointer('end', 1, 0, 0);
    assert.equal(last().stickX, 0);
    assert.equal(last().stickY, 0);
    assert.deepEqual(log, [
      ['press', 'stick', false],
      ['release', 'stick'],
    ]);
  });

  test('a stick touch elsewhere in the left half starts where the thumb landed', () => {
    const { tc, L, last } = rig();
    const x = 20;
    const y = L.stick.y + L.stick.well + 10;
    assert.equal(touchRole(L, x, y), 'stick');
    tc._pointer('start', 1, x, y);
    assert.equal(last().stickX, 0, 'no push where it landed');
    tc._pointer('move', 1, x + L.stick.travel, y);
    assert.equal(last().stickX, 1);
  });

  test('multi-touch: stick and buttons together, each by its own identifier', () => {
    const { tc, L, last } = rig();
    tc._pointer('start', 7, L.stick.x, L.stick.y);
    tc._pointer('move', 7, L.stick.x, L.stick.y - 100);
    tc._pointer('start', 9, L.buttons.A.x, L.buttons.A.y);
    assert.equal(last().A, true);
    assert.equal(last().stickY, 1);
    tc._pointer('start', 11, L.buttons.CR.x, L.buttons.CR.y);
    assert.equal(last().CR && last().A, true);
    tc._pointer('end', 9, 0, 0);
    assert.equal(last().A, false);
    assert.equal(last().CR, true);
    assert.equal(last().stickY, 1, 'the stick finger is still down');
  });

  test('rolling thumb: Z then sliding onto A holds both (backflip / long jump)', () => {
    const { tc, L, last } = rig();
    const { Z, A } = L.buttons;
    tc._pointer('start', 1, Z.x, Z.y);
    assert.equal(last().Z, true);
    tc._pointer('move', 1, A.x, A.y);
    assert.equal(last().Z && last().A, true);
    tc._pointer('move', 1, A.x, A.y - 200); // off everything: only the start button stays
    assert.equal(last().Z, true);
    assert.equal(last().A, false);
    tc._pointer('end', 1, 0, 0);
    assert.equal(last().Z, false);
  });

  test('sliding onto START or CAM presses nothing; only a touch that starts there does', () => {
    for (const [W, H] of [[390, 844], [844, 390]]) {
      const { tc, L, last } = rig(W, H);
      const { B, START, R, A } = L.buttons;
      tc._pointer('start', 1, B.x, B.y);
      for (let i = 1; i <= 8; i++) tc._pointer('move', 1, B.x + ((START.x - B.x) * i) / 8, B.y + ((START.y - B.y) * i) / 8);
      assert.equal(last().START, false, `B slid onto START (${W}x${H})`);
      assert.equal(last().B, true, 'B held until the thumb lifts');
      for (let i = 1; i <= 8; i++) tc._pointer('move', 1, START.x + ((R.x - START.x) * i) / 8, START.y + ((R.y - START.y) * i) / 8);
      assert.equal(last().R, false, 'slid on to CAM');
      tc._pointer('end', 1, 0, 0);
      // A touch that starts on START presses it.
      tc._pointer('start', 2, START.x, START.y);
      assert.equal(last().START, true);
      tc._pointer('move', 2, START.x + 3, START.y + 2);
      assert.equal(last().START, true, 'a little wobble keeps it');
      tc._pointer('end', 2, 0, 0);
      assert.equal(last().START, false);
      tc._pointer('start', 3, R.x, R.y);
      assert.equal(last().R, true);
      tc._pointer('end', 3, 0, 0);
      // A thumb rolling from A onto START does not pause either.
      tc._pointer('start', 4, A.x, A.y);
      tc._pointer('move', 4, START.x, START.y);
      assert.equal(last().START, false);
      tc._pointer('end', 4, 0, 0);
    }
  });

  test('D-pad: full push in its direction while the stick is idle', () => {
    const { tc, L, last } = rig();
    tc._pointer('start', 1, L.dpad.x, L.dpad.y - L.dpad.size * 0.4);
    assert.equal(last().stickY, 1);
    tc._pointer('move', 1, L.dpad.x + L.dpad.size * 0.4, L.dpad.y + L.dpad.size * 0.4);
    assert.ok(near(last().stickX, Math.SQRT1_2) && near(last().stickY, -Math.SQRT1_2));
    // The analog stick, when pushed, takes precedence.
    tc._pointer('start', 2, L.stick.x, L.stick.y);
    tc._pointer('move', 2, L.stick.x - 100, L.stick.y);
    assert.equal(last().stickX, -1);
    tc._pointer('end', 2, 0, 0);
    assert.ok(near(last().stickX, Math.SQRT1_2), 'back to the D-pad');
  });

  test('landscape: touches on the picture report picture: true (the title starts on them)', () => {
    const { tc, L, log } = rig(844, 390);
    tc._pointer('start', 1, L.stick.x, L.stick.y);
    tc._pointer('start', 2, L.buttons.START.x, L.buttons.START.y);
    assert.deepEqual(log, [
      ['press', 'stick', true],
      ['press', 'START', true],
    ]);
  });

  test('a lost touch end is healed; releaseAll lets go of everything', () => {
    const { tc, L, last, log } = rig();
    tc._pointer('start', 1, L.buttons.B.x, L.buttons.B.y);
    tc._pointer('start', 1, L.buttons.A.x, L.buttons.A.y); // same identifier again
    assert.equal(last().B, false);
    assert.equal(last().A, true);
    tc.releaseAll();
    assert.equal(last().A, false);
    assert.equal(tc.touches.length, 0);
    assert.deepEqual(log.at(-1), ['release', 'A']);
  });

  test('drives a real Input: a quick tap between two polls still jumps', () => {
    const events = new Events();
    const input = new Input(new EventTarget());
    input.getGamepads = () => [];
    const tc = new TouchController({ input, events });
    tc.layout = touchLayout(390, 844, {});
    tc.shown = true;
    input.poll();
    tc._pointer('start', 1, tc.layout.buttons.A.x, tc.layout.buttons.A.y);
    tc._pointer('end', 1, 0, 0);
    assert.equal(input.poll().A.pressed, true);
    tc._pointer('start', 2, tc.layout.stick.x, tc.layout.stick.y);
    tc._pointer('move', 2, tc.layout.stick.x, tc.layout.stick.y - 100);
    const c = input.poll();
    assert.equal(c.stickY, 1);
    assert.equal(c.stickMag, 1);
  });
});

describe('touch texts', () => {
  test('title prompts and the pause legend fit, in the fonts, with no trademarks', () => {
    for (const s of [TOUCH_START_PROMPT, TOUCH_UNLOCK_PROMPT, TOUCH_TITLE_HINT]) {
      assert.ok(SMALL_STRINGS.includes(s), `glyph coverage checks "${s}"`);
      assert.ok(measureText(SMALL_FONT, s) <= 300, s);
    }
    assert.ok(BIG_STRINGS.includes(TOUCH_UNLOCK_PRESS));
    assert.ok(measureText(BIG_FONT, TOUCH_UNLOCK_PRESS) * 1.2 <= 300);
    for (const t of TOUCH_CONTROLS.flat()) {
      assert.ok(SMALL_STRINGS.includes(t));
      assert.ok(!/n64|nintendo|mario/i.test(t), t);
    }
    assert.equal(controlsLegend('touch'), TOUCH_CONTROLS);
    // The pause stack fits a portrait phone's picture (the top ~58% of a 390x844 screen).
    const { W, H } = hudMetrics(390, 490);
    const lay = pauseLayout(W, H, (t) => measureText(SMALL_FONT, t), TOUCH_CONTROLS);
    assert.ok(lay.panel.y + lay.panel.h <= H, `legend bottom ${lay.panel.y + lay.panel.h} of ${H}`);
    assert.ok(lay.panel.x >= 0 && lay.panel.x + lay.panel.w <= W);
  });

  test('the pause legend shows the touch controls while the controller is shown', () => {
    const hud = new HUD(null, {});
    touchUi.active = true;
    try {
      hud.setPaused(true);
      assert.equal(hud.controls, 'touch');
    } finally {
      touchUi.active = false;
    }
    hud.setPaused(false);
    hud.setPaused(true);
    assert.equal(hud.controls, 'keys');
    hud.dispose();
  });
});

// ---- browser: real touch events drive Pip (opt-in: E2E=1) --------------------------------

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

// A phone-sized page (touch, coarse pointer) of the game in step mode; `touch(type, points)`
// sends trusted touch events through the DevTools protocol.
async function phone(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?test=1&mute=1`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
  const step = (n) => page.evaluate((n) => window.__game.step(n), n);
  const snap = () => page.evaluate(() => ({ z: window.__game.player.pos.z, y: window.__game.player.pos.y, action: window.__game.player.action }));
  return { context, page, touch, step, snap, errors };
}

test('portrait phone: the controller shows below the picture and moves Pip', { skip, timeout: 300000 }, async () => {
  const { context, page, touch, step, snap, errors } = await phone(390, 844);
  const info = await page.evaluate(() => ({
    shown: window.__game.touch.shown,
    vp: window.__game.view.viewport,
    L: window.__game.touch.layout,
  }));
  assert.equal(info.shown, true, 'a coarse pointer shows the controller');
  assert.equal(info.L.mode, 'portrait');
  assert.equal(info.vp.height, 844 - info.L.pictureBottom, 'the picture shrinks to the top');
  const { stick, buttons } = info.L;
  const z0 = (await snap()).z;
  await touch('touchStart', [[stick.x, stick.y, 1]]);
  await touch('touchMove', [[stick.x, stick.y - stick.travel, 1]]);
  await step(20);
  const run = await snap();
  assert.ok(z0 - run.z > 150, `stick up runs toward the castle: ${z0} -> ${run.z}`);
  await touch('touchStart', [[stick.x, stick.y - stick.travel, 1], [buttons.A.x, buttons.A.y, 2]]);
  await step(4);
  const jump = await snap();
  assert.match(jump.action, /jump/, `A (second finger) jumps: ${jump.action}`);
  await touch('touchEnd', []);
  await step(40);
  assert.equal(await page.evaluate(() => window.__game.input.touch.stickY), 0, 'released');

  // A browser toolbar showing or hiding (same orientation) keeps a held thumb working.
  const held = () => page.evaluate(() => ({ x: window.__game.input.touch.stickX, y: window.__game.input.touch.stickY, n: window.__game.touch.touches.length }));
  await touch('touchStart', [[stick.x, stick.y, 3]]);
  await touch('touchMove', [[stick.x, stick.y - stick.travel, 3]]);
  await page.setViewportSize({ width: 390, height: 804 });
  await page.waitForFunction(() => window.__game.touch.layout.height === 804, null, { timeout: 10000 });
  let h = await held();
  assert.deepEqual([h.y, h.n], [1, 1], 'the held stick survives the resize');
  await touch('touchMove', [[stick.x + stick.travel, stick.y, 3]]);
  h = await held();
  assert.ok(h.x > 0.99 && Math.abs(h.y) < 0.02, `the finger still steers after the resize: ${h.x}, ${h.y}`);
  await touch('touchEnd', []);
  h = await held();
  assert.deepEqual([h.x, h.y, h.n], [0, 0, 0], 'and lets go');
  // Rotating lets go of the fingers that are down (the controls move elsewhere).
  await touch('touchStart', [[stick.x, stick.y - 40, 4]]);
  await touch('touchMove', [[stick.x, stick.y - 40 - stick.travel, 4]]);
  await page.setViewportSize({ width: 804, height: 390 });
  await page.waitForFunction(() => window.__game.touch.layout.mode === 'landscape', null, { timeout: 10000 });
  h = await held();
  assert.deepEqual([h.y, h.n], [0, 0], 'rotated: released');
  await touch('touchEnd', []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('landscape phone: a floating stick in the lower left; START pauses', { skip, timeout: 300000 }, async () => {
  const { context, page, touch, step, snap, errors } = await phone(844, 390);
  const L = await page.evaluate(() => window.__game.touch.layout);
  assert.equal(L.mode, 'landscape');
  assert.equal(await page.evaluate(() => window.__game.view.viewport.height), 390);
  const z0 = (await snap()).z;
  const x = L.stickZone.x + L.stickZone.w * 0.7;
  const y = L.stickZone.y + L.stickZone.h * 0.3;
  await touch('touchStart', [[x, y, 1]]);
  await touch('touchMove', [[x, y - 60, 1]]);
  await step(20);
  assert.ok(z0 - (await snap()).z > 150, 'runs');
  await touch('touchEnd', []);
  await touch('touchStart', [[L.buttons.START.x, L.buttons.START.y, 2]]);
  await touch('touchEnd', []);
  await step(1);
  assert.equal(await page.evaluate(() => window.__game.state.paused), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('title on a phone: the first tap unlocks audio, START on the controller starts', { skip, timeout: 300000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  // No page.evaluate before the first tap (it would count as a user gesture): the title and
  // the START button's position are reported through the console.
  await page.addInitScript(() => {
    window.__card = () => {
      const el = document.querySelector('.cg-title');
      if (!el) return 'gone';
      return el.classList.contains('cg-out') ? 'fading' : el.classList.contains('cg-locked') ? 'locked' : 'ready';
    };
    new MutationObserver((_, obs) => {
      if (!document.querySelector('.cg-title canvas') || !document.querySelector('.cg-touch.cg-on .cg-tc-START')) return;
      obs.disconnect();
      const r = document.querySelector('.cg-tc-START').getBoundingClientRect();
      console.log(`TITLE_SHOWN ${window.__card()} ${r.x + r.width / 2} ${r.y + r.height / 2}`);
    }).observe(document, { childList: true, subtree: true, attributes: true });
  });
  const shown = page.waitForEvent('console', { predicate: (m) => m.text().startsWith('TITLE_SHOWN'), timeout: 180000 });
  await page.goto(`${base}/?touch=1`, { waitUntil: 'load', timeout: 180000 });
  const [, phase, x, y] = (await shown).text().split(' ');
  assert.equal(phase, 'locked', 'the card first asks for a tap (audio is held back)');
  const cdp = await context.newCDPSession(page);
  const tap = async (holdMs = 100) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Number(x), y: Number(y), id: 1 }] });
    await page.waitForTimeout(holdMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await tap();
  await page.waitForTimeout(800);
  const s = await page.evaluate(() => ({ card: window.__card(), audio: window.__game?.audio.ctx?.state ?? null }));
  assert.equal(s.card, 'ready', 'the unlocking tap only unlocks: PRESS START');
  await tap(150);
  // The face screen comes next (no mitten pointer on a touch screen); START goes on to play.
  await page.waitForFunction(() => window.__game?.state.mode === 'face' && window.__game.face?.ready, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.cg-face-cursor')).display), 'none');
  await tap(150);
  await page.waitForFunction(() => window.__game?.state.mode === 'play', null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const g = await page.evaluate(() => ({ paused: window.__game.state.paused, audio: window.__game.audio.ctx?.state }));
  assert.equal(g.paused, false, 'the START that began the game does not also pause it');
  assert.equal(g.audio, 'running');
  await context.close();
});
