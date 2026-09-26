// "AI RACE" alert: when AI RACE mode switches on, big red pixel-font letters blink over a
// pulsing red vignette for a few seconds, then fade. Like the GAME OVER card it follows its
// own box (window resizes, the 4:3 pillarbox via setViewport / alignOverlay) and the
// devicePixelRatio, redrawing the text crisply at the new scale.
// The meltdown's warning (fx/Meltdown.js, 'meltdown' { phase: 'warning' }, 30 s into the race)
// shows the same way, a little longer, in three lines (hudLogic.js MELTDOWN_WARNING: WARNING!,
// THE SKY IS OVERHEATING, POUND STOP!); it goes as soon as the race is stopped ('cancelled') or
// the sky catches fire ('fire').
//
//   const banner = new AlertBanner(uiRoot, { events });  // shows itself on 'darkMode' { on: true }
//   banner.show(lines?, { ms? })  // lines: [[text, scale, style]], default AI RACE
//   banner.setViewport(rect | null); banner.hide(); banner.kind  // 'race' | 'warning' | null

import { BIG_FONT } from './bitmapFont.js';
import { textCanvas } from './raster.js';
import { hudMetrics, boxStyle, AI_RACE, AI_RACE_SCALE, MELTDOWN_WARNING } from './hudLogic.js';
import { pixelRatio, watchPixelRatio } from './pixelRatio.js';

const SHOW_MS = 3400; // blinking, then a fade out
const WARNING_MS = 5200; // the meltdown's warning stays up a little longer
const FADE_MS = 600;
const RACE_LINES = [[AI_RACE, AI_RACE_SCALE, 'red']];

export class AlertBanner {
  constructor(root, { events } = {}) {
    this.root = root;
    this.viewport = null;
    this.el = null;
    this.px = 0;
    this.kind = null; // what shows: 'race' (AI RACE), 'warning' (the meltdown's) or null
    this.lines = RACE_LINES;
    events?.on('darkMode', ({ on }) => (on ? this.show() : this.hide()));
    events?.on('gameOver', () => this.hide());
    events?.on('meltdown', ({ phase } = {}) => {
      if (phase === 'warning') this.show(MELTDOWN_WARNING, { ms: WARNING_MS, kind: 'warning' });
      else if ((phase === 'cancelled' || phase === 'fire') && this.kind === 'warning') this.hide();
    });
  }

  setViewport(vp) {
    this.viewport = vp;
    if (this.el) Object.assign(this.el.style, boxStyle(vp));
  }

  show(lines = RACE_LINES, { ms = SHOW_MS, kind = 'race' } = {}) {
    this.hide();
    this.lines = lines;
    this.kind = kind;
    const el = document.createElement('div');
    el.className = 'cg-alert';
    el.style.cssText =
      'position:absolute;display:flex;align-items:center;justify-content:center;pointer-events:none;' +
      'background:radial-gradient(ellipse at center, rgba(120,0,0,0) 45%, rgba(150,0,10,0.55) 100%);' +
      `animation:cg-alert-pulse 0.55s steps(2, jump-none) infinite;transition:opacity ${FADE_MS}ms ease-out`;
    Object.assign(el.style, boxStyle(this.viewport));
    ensureKeyframes();
    this.textBox = document.createElement('div');
    this.textBox.style.cssText = 'display:flex;flex-direction:column;align-items:center;transform:translateY(-18%)';
    el.appendChild(this.textBox);
    this.el = el;
    this.px = 0;
    this.texts = [];
    this.root.appendChild(el);
    this._layout();
    this._observer = new ResizeObserver(() => this._layout());
    this._observer.observe(el);
    this._unwatch = watchPixelRatio(() => this._layout());
    this._fadeTimer = setTimeout(() => {
      if (this.el === el) el.style.opacity = '0';
    }, ms - FADE_MS);
    this._hideTimer = setTimeout(() => {
      if (this.el === el) this.hide();
    }, ms);
    return this;
  }

  hide() {
    clearTimeout(this._fadeTimer);
    clearTimeout(this._hideTimer);
    if (!this.el) return;
    this._observer.disconnect();
    this._unwatch();
    this.el.remove();
    this.el = this.textBox = this.text = null;
    this.texts = [];
    this.kind = null;
  }

  // Draw the text for the banner's current size: crisp device pixels, scaled like the HUD.
  _layout() {
    const el = this.el;
    if (!el) return;
    const dpr = pixelRatio();
    const { scale } = hudMetrics(el.clientWidth || innerWidth, el.clientHeight || innerHeight);
    const px = scale * dpr;
    if (Math.abs(px - this.px) < 1e-6) return;
    this.px = px;
    const texts = this.lines.map(([line, size, style]) => {
      const text = textCanvas(BIG_FONT, line, px * size, style);
      text.style.cssText = `display:block;width:${text.width / dpr}px;height:${text.height / dpr}px;image-rendering:pixelated`;
      return text;
    });
    this.textBox.replaceChildren(...texts);
    this.texts = texts;
    this.text = texts[0]; // the first (biggest) line
  }
}

// The blink: the whole banner (vignette and letters) flashes on and off.
function ensureKeyframes() {
  if (document.getElementById('cg-alert-keyframes')) return;
  const style = document.createElement('style');
  style.id = 'cg-alert-keyframes';
  style.textContent =
    '@keyframes cg-alert-pulse { 0% { visibility: visible } 100% { visibility: hidden } }' +
    '@media (prefers-reduced-motion: reduce) { .cg-alert { animation: none !important } }';
  document.head.appendChild(style);
}
