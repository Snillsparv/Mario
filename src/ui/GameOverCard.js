// GAME OVER card: the picture darkens and a big gold GAME OVER in the HUD's pixel font
// (the size of the pause screen's PAUSE) fades in at its centre.
//
//   const card = new GameOverCard(uiRoot).show();   // appended to the root, fades in
//   card.setViewport({ x, y, width, height });      // optional: picture rect (4:3 pillarbox)
//   card.remove();                                  // gone at once; show() may be called again
//
// Like the HUD it follows its own box (window resizes, setViewport(), a root moved over the
// picture by N64Renderer.alignOverlay) and the devicePixelRatio (the window moved to a monitor
// with another scale), redrawing the text at the new scale. The DOM is only touched by
// show(), so the module imports fine without one.

import { BIG_FONT } from './bitmapFont.js';
import { textCanvas } from './raster.js';
import { hudMetrics, boxStyle, GAME_OVER, GAME_OVER_SCALE } from './hudLogic.js';
import { pixelRatio, watchPixelRatio } from './pixelRatio.js';

const DIM = 'rgba(0,0,12,0.78)';
const DIM_FADE = 'background 700ms ease-in';
const TEXT_FADE = 'opacity 500ms ease-in 400ms'; // the text follows once the screen darkens

export class GameOverCard {
  constructor(root) {
    this.root = root;
    this.viewport = null;
    this.el = null;
    this.px = 0; // device px per font pixel of the current text canvas
  }

  get shown() {
    return !!this.el;
  }

  // Keep the card inside the picture rectangle (CSS px relative to the root); null fills it.
  setViewport(vp) {
    this.viewport = vp;
    if (this.el) Object.assign(this.el.style, boxStyle(vp));
  }

  show() {
    if (this.el) return this;
    const el = document.createElement('div');
    el.className = 'cg-gameover';
    el.style.cssText =
      'position:absolute;display:flex;align-items:center;justify-content:center;' +
      `pointer-events:none;background:rgba(0,0,12,0);transition:${DIM_FADE}`;
    Object.assign(el.style, boxStyle(this.viewport));
    // The fade runs on a wrapper, so a resize can swap the text canvas mid-fade.
    this.textBox = document.createElement('div');
    this.textBox.style.cssText = `display:flex;opacity:0;transition:${TEXT_FADE}`;
    el.appendChild(this.textBox);
    this.el = el;
    this.px = 0;
    this.root.appendChild(el);
    this._layout();
    this._observer = new ResizeObserver(() => this._layout());
    this._observer.observe(el);
    this._unwatch = watchPixelRatio(() => this._layout());
    el.getBoundingClientRect(); // commit the start styles so the fades run
    el.style.background = DIM;
    this.textBox.style.opacity = '1';
    return this;
  }

  remove() {
    if (!this.el) return;
    this._observer.disconnect();
    this._unwatch();
    this.el.remove();
    this.el = this.textBox = this.text = null;
  }

  // Draw the text for the card's current size: crisp device pixels, scaled like the HUD.
  _layout() {
    const el = this.el;
    if (!el) return;
    const dpr = pixelRatio();
    const { scale } = hudMetrics(el.clientWidth || innerWidth, el.clientHeight || innerHeight);
    const px = scale * dpr * GAME_OVER_SCALE;
    if (Math.abs(px - this.px) < 1e-6) return;
    this.px = px;
    const text = textCanvas(BIG_FONT, GAME_OVER, px, 'gold');
    text.style.cssText = `display:block;width:${text.width / dpr}px;height:${text.height / dpr}px;image-rendering:pixelated`;
    if (this.text) this.text.replaceWith(text);
    else this.textBox.appendChild(text);
    this.text = text;
  }
}
