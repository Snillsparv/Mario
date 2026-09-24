// Pure touch-controller helpers (no DOM): when to show it, the thumb-stick and D-pad math,
// the control layout for portrait and landscape screens, and hit-testing. Used by
// TouchController.js (see docs/ARCHITECTURE.md "Winged hat, minions, locked castle, touch
// controller") and the node tests.
//
// Coordinates are CSS pixels in the window (clientX / clientY), y down. Stick and D-pad
// vectors come out like the virtual controller's: x right, y up, magnitude 0..1.

import { hudMetrics } from './hudLogic.js';

// Buttons the controller feeds to input.setTouchState (the virtual controller's names).
export const TOUCH_BUTTONS = ['A', 'B', 'Z', 'R', 'START', 'CU', 'CD', 'CL', 'CR'];

// Thumb stick: no push inside STICK_DEADZONE of its travel; full push at STICK_FULL of it
// (a thumb rarely reaches the rim), linear in between, so the magnitude is the distance.
export const STICK_DEADZONE = 0.12;
export const STICK_FULL = 0.85;
// D-pad: a touch within this share of its half-size from the centre presses nothing.
export const DPAD_DEADZONE = 0.16;

// Shared flag: the touch controller is on screen (the title and the pause legend switch
// their texts to the touch controls). Written by TouchController only.
export const touchUi = { active: false };

// Show the controller? `?touch=1` forces it on, `?touch=0` off; otherwise touch screens
// (a coarse primary pointer).
export function wantTouchUi({ search = '', coarse = false } = {}) {
  const v = new URLSearchParams(search).get('touch');
  if (v === '1' || v === 'true' || v === '') return true;
  if (v === '0' || v === 'false') return false;
  return !!coarse;
}

// Stick vector for a thumb dx, dy (CSS px, y down) away from the stick's origin, with the
// knob able to travel `travel` px. Fills and returns `out` { x, y, mag, kx, ky } (kx, ky:
// the knob's offset in px, clamped to the travel), so it allocates nothing when out is given.
export function stickVector(dx, dy, travel, out = { x: 0, y: 0, mag: 0, kx: 0, ky: 0 }) {
  const d = Math.hypot(dx, dy);
  const t = Math.max(1e-6, travel);
  const k = d > t ? t / d : 1;
  out.kx = dx * k;
  out.ky = dy * k;
  const r = d / t;
  if (!(r > STICK_DEADZONE)) {
    out.x = 0;
    out.y = 0;
    out.mag = 0;
    return out;
  }
  const mag = Math.min(1, (r - STICK_DEADZONE) / (STICK_FULL - STICK_DEADZONE));
  out.x = (dx / d) * mag;
  out.y = (-dy / d) * mag;
  out.mag = mag;
  return out;
}

// 8-way D-pad: dx, dy from its centre (y down), `half` = half its size. Fills `out`
// { x, y, mag, up, down, left, right } with a unit vector (diagonals normalised) or zero.
export function dpadVector(dx, dy, half, out = { x: 0, y: 0, mag: 0, up: false, down: false, left: false, right: false }) {
  out.x = 0;
  out.y = 0;
  out.mag = 0;
  out.up = out.down = out.left = out.right = false;
  if (Math.hypot(dx, dy) <= DPAD_DEADZONE * half) return out;
  // Sector of 45 degrees around each of the 8 directions (0 = right, counter-clockwise).
  const sector = ((Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  const sx = [1, 1, 0, -1, -1, -1, 0, 1][sector];
  const sy = [0, 1, 1, 1, 0, -1, -1, -1][sector];
  const n = sx && sy ? Math.SQRT1_2 : 1;
  out.x = sx * n;
  out.y = sy * n;
  out.mag = 1;
  out.right = sx > 0;
  out.left = sx < 0;
  out.up = sy > 0;
  out.down = sy < 0;
  return out;
}

// ---- layout --------------------------------------------------------------------------

// Portrait: the controller body fills the bottom PORTRAIT_SHARE of the screen, the game
// picture the rest. Positions are designed on a PORTRAIT_REF (390 x 320) body and scaled
// uniformly; anchors keep the left cluster at the left edge (L), the right cluster at the
// right edge (R) and the middle column centred (C).
export const PORTRAIT_SHARE = 0.42;
export const PORTRAIT_REF = { w: 390, h: 320 };
// START and CAM sit high in the middle column, well clear of ATTACK (B): a thumb drifting off
// B must not reach START (it would pause mid-fight).
const PORTRAIT = {
  dpad: { a: 'L', x: 62, y: 72, size: 84 },
  stick: { a: 'L', x: 108, y: 206, well: 64, knob: 30, travel: 38 },
  emblem: { a: 'C', x: 0, y: 26 },
  R: { a: 'C', x: 0, y: 84, w: 50, h: 22 },
  START: { a: 'C', x: 0, y: 130, w: 58, h: 24 },
  C: { a: 'R', x: 302, y: 76, r: 16, spread: 32 },
  B: { a: 'R', x: 256, y: 184, r: 30 },
  A: { a: 'R', x: 330, y: 230, r: 38 },
  Z: { a: 'R', x: 238, y: 258, w: 74, h: 32, rot: -20 },
};

// Landscape: translucent controls over the picture, designed for a 390 px tall screen.
// Anchors: BL/BR = from the bottom-left/right corner, TL/TR = from the top corners (kept
// below the HUD's counter row, which scales with the picture: HUD_ROW_BOTTOM logical px).
export const LANDSCAPE_REF_H = 390;
export const HUD_ROW_BOTTOM = 30;
const LANDSCAPE_TOP_MIN = 63; // top edge of the highest top-anchored control (START), ref px
const LANDSCAPE = {
  stick: { a: 'BL', x: 124, y: 118, well: 60, knob: 28, travel: 36 },
  dpad: { a: 'BL', x: 66, y: 252, size: 72 },
  START: { a: 'TL', x: 70, y: 74, w: 54, h: 22 },
  A: { a: 'BR', x: 86, y: 96, r: 36 },
  B: { a: 'BR', x: 166, y: 154, r: 29 },
  Z: { a: 'BR', x: 190, y: 64, w: 68, h: 28, rot: -20 },
  C: { a: 'TR', x: 80, y: 128, r: 14, spread: 27 },
  R: { a: 'TR', x: 176, y: 102, w: 48, h: 22 },
};

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const insets = (safe) => ({ top: safe?.top || 0, right: safe?.right || 0, bottom: safe?.bottom || 0, left: safe?.left || 0 });

// Controller height for a portrait screen (includes the bottom safe-area inset: the grips
// run under the home indicator, the controls stay above it).
export function portraitHeight(width, height) {
  return Math.round(clampNum(height * PORTRAIT_SHARE, 220, Math.max(220, height * 0.5)));
}

// Circle and pill shapes: circle { kind, x, y, r }, pill { kind, x, y, w, h, rot } (rot in
// degrees, the capsule's long axis along its local x).
function circle(x, y, r) {
  return { kind: 'circle', x, y, r };
}
function pill(x, y, w, h, rot = 0) {
  return { kind: 'pill', x, y, w, h, rot, r: h / 2 };
}

// The complete layout for a window of width x height with the given safe-area insets:
// {
//   mode: 'portrait' | 'landscape', width, height, k (scale),
//   top: y where the controller body starts (portrait; 0 in landscape),
//   pictureBottom: px the game picture leaves free at the bottom (portrait: the body height),
//   body: { x, y, w, h, notchY } (portrait) | null,
//   stick: { x, y, well, knob, travel }, dpad: { x, y, size },
//   buttons: { A, B, Z, R, START, CU, CD, CL, CR } (shapes), emblem: { x, y } | null,
//   stickZone: { x, y, w, h }  (touches starting here, off the other controls, drive the stick),
//   zones: [{ x, y, w, h }]   (the areas that capture touches)
// }
// With { standalone: true } (the phone is only a controller: pad.html) the controller fills the
// whole screen instead; see padPortraitLayout / padLandscapeLayout below.
export function touchLayout(width, height, safe, opts) {
  const s = insets(safe);
  if (opts?.standalone) return height > width ? padPortraitLayout(width, height, s) : padLandscapeLayout(width, height, s);
  return height > width ? portraitLayout(width, height, s) : landscapeLayout(width, height, s);
}

function portraitLayout(W, H, s) {
  const ch = portraitHeight(W, H);
  const top = H - ch;
  const inner = ch - s.bottom - 8; // room for the controls
  const k = Math.min((W - s.left - s.right) / PORTRAIT_REF.w, inner / PORTRAIT_REF.h, 1.5);
  const oy = top + 8 + Math.max(0, inner - PORTRAIT_REF.h * k) * 0.55;
  const X = (p) => (p.a === 'L' ? s.left + p.x * k : p.a === 'R' ? W - s.right - (PORTRAIT_REF.w - p.x) * k : W / 2 + p.x * k);
  const Y = (p) => oy + p.y * k;
  const P = PORTRAIT;
  const buttons = {
    A: circle(X(P.A), Y(P.A), P.A.r * k),
    B: circle(X(P.B), Y(P.B), P.B.r * k),
    Z: pill(X(P.Z), Y(P.Z), P.Z.w * k, P.Z.h * k, P.Z.rot),
    R: pill(X(P.R), Y(P.R), P.R.w * k, P.R.h * k),
    START: pill(X(P.START), Y(P.START), P.START.w * k, P.START.h * k),
    ...cButtons(X(P.C), Y(P.C), P.C.r * k, P.C.spread * k),
  };
  const stick = { x: X(P.stick), y: Y(P.stick), well: P.stick.well * k, knob: P.stick.knob * k, travel: P.stick.travel * k };
  const dpad = { x: X(P.dpad), y: Y(P.dpad), size: P.dpad.size * k };
  // The left half, minus the middle column (START / CAM), steers the stick.
  const midHalf = Math.max(P.START.w, P.R.w) * k * 0.5 + 10 * k;
  const stickZone = { x: 0, y: top, w: W / 2 - midHalf, h: ch };
  return {
    mode: 'portrait',
    width: W,
    height: H,
    k,
    top,
    pictureBottom: ch,
    body: { x: 0, y: top, w: W, h: ch, notchY: H - Math.min(0.13 * ch, 46 * k) },
    stick,
    dpad,
    buttons,
    emblem: { x: X(P.emblem), y: Y(P.emblem) },
    stickZone,
    zones: [{ x: 0, y: top, w: W, h: ch }],
  };
}

function landscapeLayout(W, H, s) {
  const k = clampNum(H / LANDSCAPE_REF_H, 0.62, 1.4);
  const L = LANDSCAPE;
  // The HUD grows with the screen faster than the controls (k is capped): keep clear of it.
  const hudRow = HUD_ROW_BOTTOM * hudMetrics(W, H).scale + 6 * k;
  const drop = Math.max(0, hudRow - LANDSCAPE_TOP_MIN * k);
  const X = (p) => (p.a === 'BL' || p.a === 'TL' ? s.left + p.x * k : W - s.right - p.x * k);
  const Y = (p) => (p.a === 'BL' || p.a === 'BR' ? H - s.bottom - p.y * k : s.top + p.y * k + drop);
  const buttons = {
    A: circle(X(L.A), Y(L.A), L.A.r * k),
    B: circle(X(L.B), Y(L.B), L.B.r * k),
    Z: pill(X(L.Z), Y(L.Z), L.Z.w * k, L.Z.h * k, L.Z.rot),
    R: pill(X(L.R), Y(L.R), L.R.w * k, L.R.h * k),
    START: pill(X(L.START), Y(L.START), L.START.w * k, L.START.h * k),
    ...cButtons(X(L.C), Y(L.C), L.C.r * k, L.C.spread * k),
  };
  const stick = { x: X(L.stick), y: Y(L.stick), well: L.stick.well * k, knob: L.stick.knob * k, travel: L.stick.travel * k };
  const dpad = { x: X(L.dpad), y: Y(L.dpad), size: L.dpad.size * k };
  // Anywhere in the lower left of the picture starts the (floating) stick.
  const zoneTop = Math.min(dpad.y - dpad.size / 2 - 8 * k, H * 0.3);
  const stickZone = { x: 0, y: zoneTop, w: Math.round(W * 0.42), h: H - zoneTop };
  const zones = [
    stickZone,
    bounds([buttons.A, buttons.B, buttons.Z], 22 * k, W, H),
    bounds([buttons.CU, buttons.CD, buttons.CL, buttons.CR, buttons.R], 8 * k, W, H),
    bounds([buttons.START], 10 * k, W, H),
  ];
  return { mode: 'landscape', width: W, height: H, k, top: 0, pictureBottom: 0, body: null, stick, dpad, buttons, emblem: null, stickZone, zones };
}

// ---- standalone controller (pad.html: the phone only steers the game on a computer) -------
//
// No game picture: the moulded body fills the whole screen (layout.standalone = true,
// pictureBottom 0, body = the screen, with rounded lower corners: body.bottomR). The pad page's
// status strip gets a band the controls keep clear of, layout.strip = { x, y, w, h }: the top
// edge in portrait, the top middle (between the grips) in landscape. In portrait the band above
// the controls can also hold a label plate, layout.panel = { x, y, w, h } | null (the pad page
// shows the game code there). The landscape body carries gripL / gripR: where the notch between
// the two grips starts and ends on its lower edge (bodySvg).
export const PAD_STRIP_H = 30;
const PAD_STRIP_GAP = 4; // px between the strip and the screen edge / the controls

// Portrait: a PAD_PORTRAIT_REF block of controls anchored to the bottom of the screen, where the
// thumbs are: a top row (D-pad, CAM and START, the camera disc) over the thumb cluster (stick
// left; ATTACK, JUMP and the CROUCH trigger right). A taller screen widens the gap between the
// two a little (up to PAD_PORTRAIT_GAP) and leaves the rest above them to the emblem; the width
// sets the scale (anchors: L = left edge, R = right edge, C = centred).
export const PAD_PORTRAIT_REF = { w: 390, h: 515 };
const PAD_PORTRAIT_GAP = 45;
const PAD_PORTRAIT = {
  dpad: { a: 'L', x: 82, y: 92, size: 104, row: true },
  R: { a: 'C', x: 0, y: 58, w: 66, h: 28, row: true },
  START: { a: 'C', x: 0, y: 122, w: 74, h: 30, row: true },
  C: { a: 'R', x: 306, y: 92, r: 21, spread: 40, row: true },
  stick: { a: 'L', x: 110, y: 318, well: 84, knob: 40, travel: 52 },
  B: { a: 'R', x: 262, y: 268, r: 40 },
  A: { a: 'R', x: 334, y: 356, r: 48 },
  Z: { a: 'R', x: 250, y: 452, w: 100, h: 42, rot: -20 },
};

// Landscape: a wide two-grip body. Left grip: D-pad high, stick below it toward the middle;
// right grip: camera disc high, ATTACK, JUMP and the CROUCH trigger under the thumb; CAM and
// START in the middle column. Designed on a PAD_LANDSCAPE_REF screen, scaled to fit the height
// (and the width on narrow screens); extra height is split above and below.
export const PAD_LANDSCAPE_REF = { w: 720, h: 390 };
const PAD_LANDSCAPE = {
  dpad: { a: 'L', x: 84, y: 124, size: 96 },
  stick: { a: 'L', x: 170, y: 266, well: 78, knob: 37, travel: 48 },
  C: { a: 'R', x: 626, y: 118, r: 20, spread: 38 },
  B: { a: 'R', x: 508, y: 206, r: 38 },
  A: { a: 'R', x: 602, y: 276, r: 46 },
  Z: { a: 'R', x: 484, y: 330, w: 94, h: 40, rot: -20 },
  R: { a: 'C', x: 0, y: 176, w: 64, h: 28 },
  START: { a: 'C', x: 0, y: 236, w: 72, h: 30 },
};

// Buttons, stick and D-pad of a design table P placed by X(p) / Y(p) at scale k.
function placeControls(P, X, Y, k) {
  return {
    buttons: {
      A: circle(X(P.A), Y(P.A), P.A.r * k),
      B: circle(X(P.B), Y(P.B), P.B.r * k),
      Z: pill(X(P.Z), Y(P.Z), P.Z.w * k, P.Z.h * k, P.Z.rot),
      R: pill(X(P.R), Y(P.R), P.R.w * k, P.R.h * k),
      START: pill(X(P.START), Y(P.START), P.START.w * k, P.START.h * k),
      ...cButtons(X(P.C), Y(P.C), P.C.r * k, P.C.spread * k),
    },
    stick: { x: X(P.stick), y: Y(P.stick), well: P.stick.well * k, knob: P.stick.knob * k, travel: P.stick.travel * k },
    dpad: { x: X(P.dpad), y: Y(P.dpad), size: P.dpad.size * k },
  };
}

// Anchored x for a design point on a ref-wide design.
const anchorX = (p, W, s, k, refW) => (p.a === 'L' ? s.left + p.x * k : p.a === 'R' ? W - s.right - (refW - p.x) * k : W / 2 + p.x * k);

function padPortraitLayout(W, H, s) {
  const REF = PAD_PORTRAIT_REF;
  const strip = { x: s.left + 8, y: s.top + PAD_STRIP_GAP, w: Math.max(0, W - s.left - s.right - 16), h: PAD_STRIP_H };
  const y0 = strip.y + strip.h + PAD_STRIP_GAP; // the controls start below the strip
  const y1 = H - s.bottom - 8;
  const avail = Math.max(1, y1 - y0);
  const k = Math.max(0.4, Math.min((W - s.left - s.right) / REF.w, avail / REF.h, 1.6));
  const extra = Math.max(0, avail - REF.h * k);
  const gap = Math.min(extra * 0.35, PAD_PORTRAIT_GAP * k);
  const base = y1 - REF.h * k; // the block's top
  const P = PAD_PORTRAIT;
  const X = (p) => anchorX(p, W, s, k, REF.w);
  const Y = (p) => base + p.y * k - (p.row ? gap : 0);
  const { buttons, stick, dpad } = placeControls(P, X, Y, k);
  // The band between the strip and the top row (whose centre plate starts 14 px above CAM):
  // the emblem, and under it a label plate when there is room for one.
  const rowTop = buttons.R.y - buttons.R.h / 2 - 26 * k;
  const band = Math.max(0, rowTop - y0);
  let emblem = { x: W / 2, y: y0 + band / 2, size: clampNum(band * 0.09, 7.5 * k, 12 * k) };
  let panel = null;
  if (band >= 110 * k) {
    emblem = { x: W / 2, y: y0 + 20 * k, size: 10 * k };
    const top = y0 + 40 * k;
    const room = rowTop - 12 * k - top;
    const h = Math.min(150 * k, room);
    const w = Math.min(300 * k, W - s.left - s.right - 48);
    panel = { x: W / 2 - w / 2, y: top + (room - h) / 2, w, h };
  }
  const midHalf = Math.max(P.START.w, P.R.w) * k * 0.5 + 10 * k;
  return {
    mode: 'portrait',
    standalone: true,
    width: W,
    height: H,
    k,
    top: 0,
    pictureBottom: 0,
    body: { x: 0, y: 0, w: W, h: H, notchY: H, bottomR: 40 * k }, // no notch: one slab
    stick,
    dpad,
    buttons,
    emblem,
    stickZone: { x: 0, y: y0, w: W / 2 - midHalf, h: H - y0 },
    zones: [{ x: 0, y: 0, w: W, h: H }],
    strip,
    panel,
  };
}

function padLandscapeLayout(W, H, s) {
  const REF = PAD_LANDSCAPE_REF;
  const availH = Math.max(1, H - s.top - s.bottom);
  const k = clampNum(Math.min(availH / REF.h, (W - s.left - s.right) / REF.w), 0.4, 1.5);
  const oy = s.top + Math.max(0, availH - REF.h * k) * 0.5;
  const P = PAD_LANDSCAPE;
  const X = (p) => anchorX(p, W, s, k, REF.w);
  const Y = (p) => oy + p.y * k;
  const { buttons, stick, dpad } = placeControls(P, X, Y, k);
  const { START, R, CU, CD, Z, B } = buttons;
  // Strip: the top middle, between the D-pad's and the camera disc's sockets.
  const left = dpad.x + dpad.size * 0.66 + 8;
  const right = CU.x - ((CD.y - CU.y) / 2 + CU.r * 0.95 + 4 * k) - 8;
  const sw = Math.max(0, Math.min(400, right - left, 2 * Math.min(W / 2 - left, right - W / 2)));
  const strip = { x: W / 2 - sw / 2, y: s.top + PAD_STRIP_GAP, w: sw, h: PAD_STRIP_H };
  // The notch between the grips: symmetric about the middle, clear of the stick and of ATTACK /
  // CROUCH, its top under START's plate and the speaker grille.
  const zExt = extent(Z).x;
  const half = Math.max(0, Math.min(W / 2 - (stick.x + stick.well + 18 * k), Math.min(B.x - B.r, Z.x - zExt) - 18 * k - W / 2));
  // (No deeper than it is wide: on a tall tablet it would turn into a spike.)
  const notchY = Math.max(Math.min(H - 24 * k, START.y + START.h / 2 + 64 * k), H - half * 0.95);
  const plateTop = R.y - R.h / 2 - 14 * k;
  const y0 = strip.y + strip.h;
  const emblem = { x: W / 2, y: y0 + Math.max(0, plateTop - y0) / 2, size: 8.5 * k };
  const midHalf = Math.max(START.w, R.w) * 0.5 + 16 * k;
  return {
    mode: 'landscape',
    standalone: true,
    width: W,
    height: H,
    k,
    top: 0,
    pictureBottom: 0,
    body: { x: 0, y: 0, w: W, h: H, notchY, gripL: W / 2 - half, gripR: W / 2 + half, bottomR: 44 * k },
    stick,
    dpad,
    buttons,
    emblem,
    stickZone: { x: 0, y: 0, w: W / 2 - midHalf, h: H },
    zones: [{ x: 0, y: 0, w: W, h: H }],
    strip,
    panel: null,
  };
}

// Four camera buttons in a diamond around (x, y).
function cButtons(x, y, r, spread) {
  return {
    CU: circle(x, y - spread, r),
    CD: circle(x, y + spread, r),
    CL: circle(x - spread, y, r),
    CR: circle(x + spread, y, r),
  };
}

// Axis-aligned box around shapes, grown by `pad` and clipped to the screen.
export function bounds(shapes, pad = 0, W = Infinity, H = Infinity) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of shapes) {
    const ex = b.kind === 'pill' ? extent(b) : { x: b.r, y: b.r };
    x0 = Math.min(x0, b.x - ex.x);
    x1 = Math.max(x1, b.x + ex.x);
    y0 = Math.min(y0, b.y - ex.y);
    y1 = Math.max(y1, b.y + ex.y);
  }
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W, x1 + pad);
  y1 = Math.min(H, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Half-extents of a rotated pill's bounding box.
function extent(p) {
  const a = (p.rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const sn = Math.abs(Math.sin(a));
  const half = (p.w - p.h) / 2;
  return { x: half * c + p.h / 2, y: half * sn + p.h / 2 };
}

// Distance from (x, y) to a shape's edge (negative inside).
export function shapeDistance(b, x, y) {
  if (b.kind === 'circle') return Math.hypot(x - b.x, y - b.y) - b.r;
  const a = (-b.rot * Math.PI) / 180;
  const dx = x - b.x;
  const dy = y - b.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  const half = Math.max(0, (b.w - b.h) / 2);
  const cx = Math.max(-half, Math.min(half, lx));
  return Math.hypot(lx - cx, ly) - b.h / 2;
}

// Hit slack: a press lands on a button when it is within this many px of its edge (small
// buttons get a relatively bigger margin, so they are easy to hit with a thumb).
export function hitSlack(b, k = 1) {
  return Math.max(8 * k, b.r * 0.35);
}

// System buttons (pause, camera mode): pressed only by a touch that starts on them, never by
// a thumb sliding onto them (the rolling thumb is for Z -> A and the like), and they lose a
// near tie against a play button.
export const SYSTEM_BUTTONS = ['START', 'R'];
const SYSTEM_BIAS = 6; // px (x k) added to a system button's edge distance when ranking
export const isSystemButton = (name) => name === 'START' || name === 'R';

// Whether a touch that started as `origin` (a button name, or null for one that started
// between the controls) presses `name` when it slides onto it.
export function slidePresses(origin, name) {
  return name === origin || !isSystemButton(name);
}

// The button under (x, y): the one whose edge is nearest among those within their hit slack
// (system buttons ranked a few px farther), or null. Allocation-free.
export function buttonAt(layout, x, y) {
  let best = null;
  let bestD = Infinity;
  const bs = layout.buttons;
  for (let i = 0; i < TOUCH_BUTTONS.length; i++) {
    const name = TOUCH_BUTTONS[i];
    const b = bs[name];
    const d = shapeDistance(b, x, y);
    if (d > hitSlack(b, layout.k)) continue;
    const rank = isSystemButton(name) ? d + SYSTEM_BIAS * layout.k : d;
    if (rank < bestD) {
      bestD = rank;
      best = name;
    }
  }
  return best;
}

// Whether (x, y) is on the D-pad (its square, grown a little).
export function onDpad(layout, x, y) {
  const d = layout.dpad;
  const h = d.size / 2 + 6 * layout.k;
  return Math.abs(x - d.x) <= h && Math.abs(y - d.y) <= h;
}

const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// What a touch starting at (x, y) takes hold of: a button name, 'dpad', 'stick', 'none' (on
// the controller between controls: it presses whatever it slides onto) or null (outside the
// controller: the picture). Buttons first, then the D-pad, then the stick well and zone.
export function touchRole(layout, x, y) {
  let inside = false;
  for (let i = 0; i < layout.zones.length && !inside; i++) inside = inRect(layout.zones[i], x, y);
  if (!inside) return null;
  const b = buttonAt(layout, x, y);
  if (b) return b;
  if (onDpad(layout, x, y)) return 'dpad';
  if (inWell(layout, x, y) || inRect(layout.stickZone, x, y)) return 'stick';
  return 'none';
}

// Whether a stick touch starting at (x, y) grabs the knob in its well (true) or starts a
// floating stick where the thumb landed (false).
export function inWell(layout, x, y) {
  const s = layout.stick;
  return Math.hypot(x - s.x, y - s.y) <= s.well * 1.1;
}
