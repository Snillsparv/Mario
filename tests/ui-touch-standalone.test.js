// Standalone touch controller (the phone's pad page, pad.html): the full-screen portrait and
// landscape layouts (src/ui/touchLogic.js touchLayout(..., { standalone: true })) and the
// TouchController's standalone mode feeding a sink instead of the game's input. The in-game
// mode must stay exactly as it was (tests/ui-touch.test.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  touchLayout,
  touchRole,
  buttonAt,
  shapeDistance,
  bounds,
  inWell,
  TOUCH_BUTTONS,
  PAD_STRIP_H,
} from '../src/ui/touchLogic.js';
import { TouchController, bodySvg } from '../src/ui/TouchController.js';
import { Events } from '../src/core/events.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const PORTRAITS = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [360, 780],
  [430, 932],
  [768, 1024],
];
const LANDSCAPES = [
  [568, 320],
  [640, 360],
  [667, 375],
  [844, 390],
  [932, 430],
  [1024, 768],
];
const PORTRAIT_SAFES = [{}, { top: 47, bottom: 34 }, { top: 24 }];
// Notch / home-indicator insets on the phones that have them (the small ones do not).
const landscapeSafes = (W) => (W >= 800 ? [{}, { left: 47, right: 47, bottom: 21 }, { left: 59, bottom: 21 }] : [{}]);

// Edge-to-edge distance test between two shapes: sample a's outline against b.
function outline(a) {
  const pts = [];
  if (a.kind === 'circle') for (let i = 0; i < 32; i++) pts.push([a.x + Math.cos((i / 32) * 2 * Math.PI) * a.r, a.y + Math.sin((i / 32) * 2 * Math.PI) * a.r]);
  else {
    const r = (a.rot * Math.PI) / 180;
    for (let i = 0; i <= 16; i++) {
      for (const side of [-1, 1]) {
        const lx = (i / 16 - 0.5) * (a.w - a.h);
        const ly = (side * a.h) / 2;
        pts.push([a.x + lx * Math.cos(r) - ly * Math.sin(r), a.y + lx * Math.sin(r) + ly * Math.cos(r)]);
      }
    }
    for (const end of [-1, 1]) {
      const cx = a.x + ((end * (a.w - a.h)) / 2) * Math.cos(r);
      const cy = a.y + ((end * (a.w - a.h)) / 2) * Math.sin(r);
      for (let i = 0; i < 16; i++) pts.push([cx + Math.cos((i / 16) * 2 * Math.PI) * a.r, cy + Math.sin((i / 16) * 2 * Math.PI) * a.r]);
    }
  }
  return pts;
}
const closer = (a, b, gap) => outline(a).some(([x, y]) => shapeDistance(b, x, y) < gap);
const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Everything a finger can press, as boxes: each button, the stick well, the D-pad's socket and
// the camera rocker (the disc around the four C buttons).
function controlBoxes(L) {
  const boxes = Object.entries(L.buttons).map(([n, b]) => [n, bounds([b])]);
  const s = L.stick;
  boxes.push(['stick', { x: s.x - s.well, y: s.y - s.well, w: s.well * 2, h: s.well * 2 }]);
  const d = L.dpad;
  const sock = d.size * 0.66;
  boxes.push(['dpad', { x: d.x - sock, y: d.y - sock, w: sock * 2, h: sock * 2 }]);
  const cu = L.buttons.CU;
  const cd = L.buttons.CD;
  const rr = (cd.y - cu.y) / 2 + cu.r * 0.95 + 4 * L.k;
  boxes.push(['rocker', { x: cu.x - rr, y: (cu.y + cd.y) / 2 - rr, w: rr * 2, h: rr * 2 }]);
  return boxes;
}

function checkStandalone(L, s, W, H, mode) {
  const tag = `${W}x${H} ${JSON.stringify(s)}`;
  assert.equal(L.mode, mode, tag);
  assert.equal(L.standalone, true);
  assert.equal(L.pictureBottom, 0, 'no picture to make room for');
  assert.deepEqual([L.body.x, L.body.y, L.body.w, L.body.h], [0, 0, W, H], 'the body fills the screen');
  assert.deepEqual(L.zones, [{ x: 0, y: 0, w: W, h: H }], 'the whole screen takes touches');
  assert.deepEqual(Object.keys(L.buttons).sort(), [...TOUCH_BUTTONS].sort());
  const left = s.left ?? 0;
  const right = W - (s.right ?? 0);
  const top = s.top ?? 0;
  const bottom = H - (s.bottom ?? 0);
  for (const [n, b] of Object.entries(L.buttons)) {
    const box = bounds([b]);
    assert.ok(box.x >= left - 0.5 && box.x + box.w <= right + 0.5, `${n} inside the safe width (${tag})`);
    assert.ok(box.y >= top - 0.5 && box.y + box.h <= bottom + 0.5, `${n} inside the safe height (${tag})`);
    assert.equal(buttonAt(L, b.x, b.y), n, `${n} hit at its centre (${tag})`);
    assert.equal(touchRole(L, b.x, b.y), n);
    for (const m of Object.keys(L.buttons)) if (m < n) assert.ok(!closer(L.buttons[m], b, 3), `${m} and ${n} apart (${tag})`);
    assert.ok(Math.hypot(b.x - L.stick.x, b.y - L.stick.y) > L.stick.well + (b.r ?? 0), `${n} off the stick (${tag})`);
  }
  // The stick well and the D-pad keep clear of each other and of the buttons.
  const s0 = L.stick;
  const d = L.dpad;
  assert.ok(Math.hypot(s0.x - d.x, s0.y - d.y) > s0.well + d.size * 0.66, `stick and D-pad apart (${tag})`);
  assert.ok(s0.x - s0.well >= left - 0.5 && s0.y + s0.well <= bottom, `stick inside (${tag})`);
  for (const n of TOUCH_BUTTONS) {
    const b = L.buttons[n];
    assert.ok(Math.abs(b.x - d.x) > d.size / 2 + (b.r ?? 0) || Math.abs(b.y - d.y) > d.size / 2 + (b.r ?? 0), `${n} off the D-pad (${tag})`);
  }
  // Thumb-sized: big JUMP / ATTACK, a roomy stick.
  assert.ok(L.buttons.A.r * 2 >= 60 && L.buttons.B.r * 2 >= 50, `A ${L.buttons.A.r * 2}px, B ${L.buttons.B.r * 2}px (${tag})`);
  assert.ok(s0.well >= 55 && s0.travel >= 35, `stick well ${s0.well} (${tag})`);
  // Stick and D-pad left; the play and camera buttons right; CAM and START in the middle.
  assert.ok(s0.x < W / 2 && d.x < W / 2);
  for (const n of ['A', 'B', 'Z', 'CU', 'CD', 'CL', 'CR']) assert.ok(L.buttons[n].x > W / 2, `${n} on the right (${tag})`);
  assert.ok(near(L.buttons.START.x, W / 2) && near(L.buttons.R.x, W / 2));
  // START and CAM well clear of the play buttons (a drifting thumb must not pause).
  for (const sys of ['START', 'R']) for (const play of ['A', 'B', 'Z']) assert.ok(!closer(L.buttons[sys], L.buttons[play], 22 * L.k), `${sys}-${play} (${tag})`);
  // Roles: the whole well grabs the stick; the D-pad; the stick zone on the left.
  assert.equal(touchRole(L, s0.x, s0.y), 'stick');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI;
    assert.equal(touchRole(L, s0.x + Math.cos(a) * s0.well * 0.95, s0.y + Math.sin(a) * s0.well * 0.95), 'stick', `well rim ${i * 45} (${tag})`);
  }
  assert.equal(touchRole(L, d.x, d.y), 'dpad');
  assert.ok(L.stickZone.x + L.stickZone.w < L.buttons.START.x - L.buttons.START.w / 2, 'the stick zone stops left of the middle column');
  // The status strip: on screen, inside the safe area, clear of every control.
  const st = L.strip;
  assert.equal(st.h, PAD_STRIP_H);
  assert.ok(st.w >= 240, `strip wide enough for its text (${st.w}, ${tag})`);
  assert.ok(st.x >= left && st.x + st.w <= right + 0.5 && st.y >= top && st.y + st.h <= bottom, `strip on screen (${tag})`);
  for (const [n, box] of controlBoxes(L)) assert.ok(!rectsOverlap(st, box), `strip clear of ${n} (${tag})`);
  // Labels under Z / A fit above the bottom edge.
  const z = L.buttons.Z;
  assert.ok(z.y + z.h / 2 + 17 * L.k + 11 * L.k <= H, `CROUCH label on screen (${tag})`);
  const svg = bodySvg(L);
  assert.ok(!/NaN|undefined|Infinity/.test(svg), 'body SVG numbers');
}

describe('standalone layouts', () => {
  test('portrait: the controller fills the screen; the thumbs get the lower half', () => {
    for (const [W, H] of PORTRAITS) {
      for (const s of PORTRAIT_SAFES) {
        const L = touchLayout(W, H, s, { standalone: true });
        checkStandalone(L, s, W, H, 'portrait');
        const tag = `${W}x${H}`;
        // The strip keeps the top edge; everything else is below it.
        for (const [n, box] of controlBoxes(L)) assert.ok(box.y >= L.strip.y + L.strip.h, `${n} below the strip (${tag})`);
        // The thumb cluster sits low: the stick and JUMP in the lower half, CROUCH near the bottom.
        assert.ok(L.stick.y > H / 2 && L.buttons.A.y > H / 2, `thumb cluster low (${tag})`);
        assert.ok(H - (s.bottom ?? 0) - L.buttons.Z.y < 90 * L.k, `CROUCH near the bottom (${tag})`);
        // The top row: D-pad, camera disc, CAM, START above the thumb cluster.
        for (const n of ['R', 'START', 'CU']) assert.ok(L.buttons[n].y < L.buttons.B.y - L.buttons.B.r, `${n} in the top row (${tag})`);
        // The label plate, where there is room: on screen, clear of the strip and the controls.
        if (L.panel) {
          assert.ok(L.panel.y >= L.strip.y + L.strip.h && L.panel.x >= 0 && L.panel.x + L.panel.w <= W);
          for (const [n, box] of controlBoxes(L)) assert.ok(!rectsOverlap(L.panel, box), `plate clear of ${n} (${tag})`);
          assert.ok(L.emblem.y < L.panel.y, 'the emblem above the plate');
        } else {
          assert.ok(L.emblem.y > L.strip.y + L.strip.h && L.emblem.y < L.buttons.R.y - L.buttons.R.h / 2 - 10 * L.k, `emblem in the free band (${tag})`);
        }
        assert.equal(L.body.notchY, H, 'portrait: one slab, no notch');
      }
    }
    // A tall phone has room for the plate; the same phone's space above the controls is not wasted.
    assert.ok(touchLayout(390, 844, {}, { standalone: true }).panel.h >= 120);
  });

  test('landscape: a wide two-grip body, all controls under the thumbs', () => {
    for (const [W, H] of LANDSCAPES) {
      for (const s of landscapeSafes(W)) {
        const L = touchLayout(W, H, s, { standalone: true });
        checkStandalone(L, s, W, H, 'landscape');
        const tag = `${W}x${H} ${JSON.stringify(s)}`;
        // Grips: the notch between them clears the stick, ATTACK and CROUCH, symmetric about the
        // middle, its top under START.
        const { gripL, gripR, notchY } = L.body;
        assert.ok(gripL < W / 2 && gripR > W / 2 && near(gripL + gripR, W, 1e-6), tag);
        assert.ok(gripL >= L.stick.x + L.stick.well, `notch clear of the stick (${tag})`);
        assert.ok(gripR <= L.buttons.B.x - L.buttons.B.r && gripR <= bounds([L.buttons.Z]).x, `notch clear of B and Z (${tag})`);
        assert.ok(notchY > L.buttons.START.y + L.buttons.START.h / 2 + 30 * L.k && notchY < H, `notch under START (${tag})`);
        // Each thumb's controls within reach of its side: nothing further than 45% of the width in.
        for (const n of ['A', 'B', 'Z', 'CU', 'CD', 'CL', 'CR']) assert.ok(W - L.buttons[n].x < 0.45 * W + 40, `${n} reachable (${tag})`);
        assert.ok(L.stick.x < 0.35 * W && L.dpad.x < 0.3 * W, `left grip (${tag})`);
        // The strip in the top middle.
        assert.ok(near(L.strip.x + L.strip.w / 2, W / 2, 1e-6));
        assert.equal(L.panel, null);
      }
    }
  });

  test('the in-game layouts are untouched by the option', () => {
    for (const [W, H] of [...PORTRAITS, ...LANDSCAPES]) {
      const a = touchLayout(W, H, { bottom: 20 });
      assert.deepEqual(touchLayout(W, H, { bottom: 20 }, { standalone: false }), a);
      assert.deepEqual(touchLayout(W, H, { bottom: 20 }, undefined), a);
      assert.equal(a.standalone, undefined);
      assert.equal(a.strip, undefined);
    }
  });
});

// Standalone TouchController without a DOM: laid out by hand, states captured from the sink.
function padRig(W = 390, H = 844, extra = {}) {
  const events = new Events();
  const states = [];
  const touched = [];
  const input = { setTouchState: (st) => touched.push({ ...st }), addLookDelta() {} };
  const tc = new TouchController({ standalone: true, input, events, sink: (st) => states.push({ ...st }), ...extra });
  tc.layout = touchLayout(W, H, {}, { standalone: true });
  tc.shown = true;
  const log = [];
  events.on('touchPress', (e) => log.push(['press', e.button, e.picture]));
  events.on('touchRelease', (e) => log.push(['release', e.button]));
  return { tc, L: tc.layout, states, last: () => states[states.length - 1], touched, log };
}

describe('standalone TouchController', () => {
  test('feeds the sink, never the game input', () => {
    const { tc, L, last, states, touched, log } = padRig();
    assert.equal(tc.standalone, true);
    tc._pointer('start', 1, L.stick.x, L.stick.y);
    tc._pointer('move', 1, L.stick.x, L.stick.y - L.stick.travel);
    assert.equal(last().stickY, 1);
    tc._pointer('start', 2, L.buttons.A.x, L.buttons.A.y);
    assert.equal(last().A, true);
    assert.equal(last().stickY, 1, 'both fingers');
    tc._pointer('end', 2, 0, 0);
    tc._pointer('end', 1, 0, 0);
    assert.deepEqual([last().A, last().stickX, last().stickY], [false, 0, 0]);
    assert.ok(states.length >= 4);
    assert.equal(touched.length, 0, 'input.setTouchState is not used in standalone mode');
    assert.deepEqual(log, [
      ['press', 'stick', false],
      ['press', 'A', false],
      ['release', 'A'],
      ['release', 'stick'],
    ]);
  });

  test('every button reaches the sink by its protocol name', () => {
    for (const [W, H] of [[390, 844], [844, 390]]) {
      const { tc, L, last } = padRig(W, H);
      for (const [i, b] of TOUCH_BUTTONS.entries()) {
        tc._pointer('start', 10 + i, L.buttons[b].x, L.buttons[b].y);
        assert.equal(last()[b], true, `${b} (${W}x${H})`);
        for (const o of TOUCH_BUTTONS) if (o !== b) assert.equal(last()[o], false, `${b} alone (${W}x${H})`);
        tc._pointer('end', 10 + i, 0, 0);
        assert.equal(last()[b], false);
      }
    }
  });

  test('landscape: no picture, the stick well stays put (relative stick off the well)', () => {
    const { tc, L, last, log } = padRig(844, 390);
    const x = L.stickZone.x + 20;
    const y = L.stick.y + L.stick.well + 12;
    assert.equal(touchRole(L, x, y), 'stick');
    assert.equal(inWell(L, x, y), false);
    tc._pointer('start', 1, x, y);
    assert.equal(tc.touches[0].floating, false);
    assert.equal(last().stickX, 0, 'no push where it landed');
    tc._pointer('move', 1, x + L.stick.travel, y);
    assert.equal(last().stickX, 1);
    assert.deepEqual(log[0], ['press', 'stick', false]);
  });

  test('rolling thumb and system buttons work as in the game', () => {
    const { tc, L, last } = padRig(390, 844);
    const { Z, A, B, START } = L.buttons;
    tc._pointer('start', 1, Z.x, Z.y);
    tc._pointer('move', 1, A.x, A.y);
    assert.equal(last().Z && last().A, true, 'Z then A (backflip)');
    tc._pointer('end', 1, 0, 0);
    tc._pointer('start', 2, B.x, B.y);
    for (let i = 1; i <= 8; i++) tc._pointer('move', 2, B.x + ((START.x - B.x) * i) / 8, B.y + ((START.y - B.y) * i) / 8);
    assert.equal(last().START, false, 'sliding onto START never pauses');
    tc._pointer('end', 2, 0, 0);
    tc._pointer('start', 3, START.x, START.y);
    assert.equal(last().START, true);
    tc.releaseAll();
    assert.equal(last().START, false);
  });

  test('haptics option takes the press buzz', () => {
    const buzz = [];
    const { tc } = padRig(390, 844, { haptics: (ms) => buzz.push(ms) });
    tc._buzz(); // (the press detection that calls it paints the DOM: see the browser test)
    assert.deepEqual(buzz, [10]);
  });

  test('the default in-game controller still feeds input.setTouchState', () => {
    const touched = [];
    const tc = new TouchController({ input: { setTouchState: (st) => touched.push({ ...st }) }, events: new Events() });
    assert.equal(tc.standalone, false);
    assert.equal(tc.sink, null);
    tc.layout = touchLayout(390, 844, {});
    tc.shown = true;
    tc._pointer('start', 1, tc.layout.buttons.A.x, tc.layout.buttons.A.y);
    assert.equal(touched.at(-1).A, true);
  });
});
