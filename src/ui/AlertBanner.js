// "AI RACE" alert: when AI RACE mode switches on, big red pixel-font letters blink over a
// pulsing red vignette for a few seconds, then fade. Like the GAME OVER card it follows its
// own box (window resizes, the 4:3 pillarbox via setViewport / alignOverlay) and the
// devicePixelRatio, redrawing the text crisply at the new scale.
//
//   const banner = new AlertBanner(uiRoot, { events });  // shows itself on 'darkMode' { on: true }
//   banner.setViewport(rect | null); banner.hide();

import { BIG_FONT } from './bitmapFont.js';
import { textCanvas } from './raster.js';
import { hudMetrics, boxStyle, AI_RACE, AI_RACE_SCALE } from './hudLogic.js';
import { pixelRatio, watchPixelRatio } from './pixelRatio.js';

const SHOW_MS = 3400; // blinking, then a fade out
const FADE_MS = 600;

export class AlertBanner {
  constructor(root, { events } = {}) {
    this.root = root;
    this.viewport = null;
    this.el = null;
    this.px = 0;
    events?.on('darkMode', ({ on }) => (on ? this.show() : this.hide()));
    events?.on('gameOver', () => this.hide());
  }

  setViewport(vp) {
    this.viewport = vp;
    if (this.el) Object.assign(this.el.style, boxStyle(vp));
  }

  show() {
    this.hide();
    const el = document.createElement('div');
    el.className = 'cg-alert';
    el.style.cssText =
      'position:absolute;display:flex;align-items:center;justify-content:center;pointer-events:none;' +
      'background:radial-gradient(ellipse at center, rgba(120,0,0,0) 45%, rgba(150,0,10,0.55) 100%);' +
      `animation:cg-alert-pulse 0.55s steps(2, jump-none) infinite;transition:opacity ${FADE_MS}ms ease-out`;
    Object.assign(el.style, boxStyle(this.viewport));
    ensureKeyframes();
    this.textBox = document.createElement('div');
    this.textBox.style.cssText = 'display:flex;transform:translateY(-18%)';
    el.appendChild(this.textBox);
    this.el = el;
    this.px = 0;
    this.root.appendChild(el);
    this._layout();
    this._observer = new ResizeObserver(() => this._layout());
    this._observer.observe(el);
    this._unwatch = watchPixelRatio(() => this._layout());
    this._fadeTimer = setTimeout(() => {
      if (this.el === el) el.style.opacity = '0';
    }, SHOW_MS - FADE_MS);
    this._hideTimer = setTimeout(() => {
      if (this.el === el) this.hide();
    }, SHOW_MS);
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
  }

  // Draw the text for the banner's current size: crisp device pixels, scaled like the HUD.
  _layout() {
    const el = this.el;
    if (!el) return;
    const dpr = pixelRatio();
    const { scale } = hudMetrics(el.clientWidth || innerWidth, el.clientHeight || innerHeight);
    const px = scale * dpr * AI_RACE_SCALE;
    if (Math.abs(px - this.px) < 1e-6) return;
    this.px = px;
    const text = textCanvas(BIG_FONT, AI_RACE, px, 'red');
    text.style.cssText = `display:block;width:${text.width / dpr}px;height:${text.height / dpr}px;image-rendering:pixelated`;
    if (this.text) this.text.replaceWith(text);
    else this.textBox.appendChild(text);
    this.text = text;
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
