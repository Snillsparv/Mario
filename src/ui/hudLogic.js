// Pure HUD helpers (no DOM): screen metrics, counters and animation curves.

// The HUD is designed on a 320x240 grid and scaled by viewport height (or by width on
// screens narrower than 4:3). Returns device pixels per logical pixel and the logical size.
export function hudMetrics(width, height) {
  const scale = Math.max(0.5, Math.min(height / 240, width / 320));
  return { scale, W: width / scale, H: height / scale };
}

// Inline position/size placing an overlay over the picture rectangle vp ({ x, y, width,
// height } in CSS px relative to its container, e.g. the renderer's 4:3 pillarbox
// viewport); null fills the container.
export function boxStyle(vp) {
  if (!vp) return { left: '0', top: '0', width: '100%', height: '100%' };
  return { left: `${vp.x}px`, top: `${vp.y}px`, width: `${vp.width}px`, height: `${vp.height}px` };
}

// Displayed number that counts up one step per tick towards the real value (like the coin
// counter rolling up after a multi-coin pickup). Decreases (e.g. a reset) snap immediately.
export class RollingCounter {
  constructor(value = 0) {
    this.shown = value;
  }

  // Returns true when the displayed value went up this tick (the HUD bumps the number).
  tick(target) {
    if (target < this.shown) {
      this.shown = target;
      return false;
    }
    if (target > this.shown) {
      this.shown++;
      return true;
    }
    return false;
  }
}

export const BUMP_TIME = 0.22; // seconds
export const RED_COIN_TIME = 1.5; // seconds the red-coin number stays up

// Vertical hop (0..1) and scale for a counter bump `t` seconds after it started.
export function bumpCurve(t) {
  if (t < 0 || t >= BUMP_TIME) return { hop: 0, scale: 1 };
  const k = Math.sin((t / BUMP_TIME) * Math.PI);
  return { hop: k, scale: 1 + 0.18 * k };
}

// Red-coin number pop: scale overshoots in, holds, then the number drifts up and fades.
export function redCoinCurve(t) {
  if (t < 0 || t >= RED_COIN_TIME) return null;
  const pop = Math.min(1, t / 0.18);
  const overshoot = pop < 1 ? pop * 1.35 : 1 + 0.35 * Math.max(0, 1 - (t - 0.18) / 0.12);
  const fadeStart = RED_COIN_TIME - 0.45;
  const f = Math.max(0, (t - fadeStart) / 0.45);
  return { scale: overshoot, alpha: 1 - f, rise: f * f };
}

// Ease used by the power meter slide: a small overshoot when dropping in.
export function easeOutBack(t) {
  const c = 1.6;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

// Power-meter slide. `t` runs linearly between 0 (hidden above the screen) and 1 (shown);
// `drop` eases it with a small overshoot. Showing and hiding share the one curve, so
// reversing mid-slide never jumps: hiding plays it backwards (a little dip, then up).
export class MeterSlide {
  constructor(duration = 0.4) {
    this.duration = duration;
    this.t = 0;
  }

  // Advance by dt seconds towards shown/hidden; returns true while still moving.
  step(visible, dt) {
    const target = visible ? 1 : 0;
    const d = dt / this.duration;
    this.t = this.t < target ? Math.min(target, this.t + d) : Math.max(target, this.t - d);
    return this.t !== target;
  }

  get drop() {
    return easeOutBack(this.t);
  }
}

// Controls legends shown on the pause screen: [control, action]. The gamepad legend
// follows the standard-mapping bindings in core/input.js and replaces the keyboard one
// while a pad is connected.
export const KEY_CONTROLS = [
  ['WASD', 'Move'],
  ['Q', 'Walk (hold)'],
  ['Space / K', 'Jump'],
  ['J', 'Attack / Dive'],
  ['Shift / L', 'Crouch / Ground pound'],
  ['Arrow keys', 'Camera'],
  ['C', 'Camera mode'],
  ['Mouse drag', 'Orbit camera'],
  ['Esc / Enter', 'Pause'],
  ['F2', 'N64 filter'],
  ['F3', '4:3 screen'],
];
export const PAD_CONTROLS = [
  ['Left stick', 'Move (tilt to walk)'],
  ['A', 'Jump'],
  ['B / X', 'Attack / Dive'],
  ['LB / LT / RT', 'Crouch / Ground pound'],
  ['Right stick / D-pad', 'Camera'],
  ['RB', 'Camera mode'],
  ['Start', 'Pause'],
];

// Lay a legend out in two columns when they fit the logical width W, else one.
// measure(text) returns a width in logical pixels. Each column has its own key width.
// Returns { columns: [{ items, keyWidth, width }], rows, width, gap, colGap }.
export function legendLayout(W, measure, controls = KEY_CONTROLS, gap = 8, colGap = 18, margin = 20) {
  const column = (items) => {
    const keyWidth = Math.max(...items.map(([k]) => measure(k)));
    return { items, keyWidth, width: keyWidth + gap + Math.max(...items.map(([, a]) => measure(a))) };
  };
  const half = Math.ceil(controls.length / 2);
  const two = [column(controls.slice(0, half)), column(controls.slice(half))];
  const width2 = two[0].width + colGap + two[1].width;
  if (width2 <= W - 2 * margin) return { columns: two, rows: half, width: width2, gap, colGap };
  const one = column(controls);
  return { columns: [one], rows: controls.length, width: one.width, gap, colGap };
}

export const PAUSE_BOTTOM_MARGIN = 12; // logical px kept free under the controls panel
const HUD_ROW_BOTTOM = 34; // the pause stack never slides up over the HUD counters

// Vertical stack of the pause screen in logical px: course name (top), coin/star tally
// (top + 16), PAUSE (pauseY) and the controls panel. A narrow screen gets a one-column
// legend without its header and with tighter lines; if the stack would still run into the
// bottom margin it slides up, but never over the HUD row.
export function pauseLayout(W, H, measure, controls = KEY_CONTROLS) {
  const legend = legendLayout(W, measure, controls);
  const wide = legend.columns.length > 1;
  const lineH = wide ? 12 : 9;
  const padX = 10;
  const padY = 8;
  const headerH = wide ? 14 : 0;
  const panelW = legend.width + padX * 2;
  const panelH = headerH + legend.rows * lineH + padY * 2 - 3;
  const stackH = 74 + panelH; // course name top to panel bottom
  let top = Math.max(36, H * 0.17);
  top -= Math.max(0, Math.min(top + stackH + PAUSE_BOTTOM_MARGIN - H, top - HUD_ROW_BOTTOM));
  const pauseY = top + 40;
  const panelY = pauseY + 34;
  return {
    legend,
    wide,
    lineH,
    padX,
    padY,
    headerH,
    top,
    pauseY,
    panel: { x: W / 2 - panelW / 2, y: panelY, w: panelW, h: panelH },
  };
}

export const COURSE_NAME = 'CASTLE GROUNDS';

// Title card lines under the logo.
export const START_PROMPT = 'Press Enter, Space or click to start';
export const TITLE_HINT = 'WASD move · Space jump · J attack · Esc pause';

// Every string the UI draws with each font (the glyph-coverage test checks these).
export const BIG_STRINGS = ['0123456789×', 'PAUSE', COURSE_NAME, 'PRESS START', 'PIP'];
export const SMALL_STRINGS = [...KEY_CONTROLS.flat(), ...PAD_CONTROLS.flat(), 'starring', 'CONTROLS', START_PROMPT, TITLE_HINT, '×0123456789'];
