// Sign dialog box: a dark, see-through rounded panel in the upper middle of the picture
// (under the HUD row and the power meter, clear of Pip and the sign the camera frames below,
// see dialogLogic.js BOX / boxTop) with the sign's text typed out in the HUD's small pixel
// font (see docs/ARCHITECTURE.md "Signs and dialog").
//
//   const dialog = new DialogBox(uiRoot, { events });  // opens on 'signRead' { sign }
//   dialog.isOpen
//   dialog.update(controller)   // 30 Hz while open: A or B completes the typing, then pages on
//   dialog.close()              // at once (title, game over)
//   dialog.setViewport(rect | null)   // picture rect in the root (4:3 pillarbox), like the HUD
//
// Every open ends with exactly one 'dialogClosed' { sign }: after the last page (then with the
// 'dialog_close' sfx and a short fade), or from close() (then { sign, cancelled: true }), so a
// reader waiting for it is always released. Sounds (sfx events): 'dialog_open', 'text_blip'
// while typing (throttled, see dialogLogic.js TYPING), 'dialog_next', 'dialog_close'.
// A click or tap on the box counts as a press (touch screens). The box hides while the game
// is paused (the pause screen is drawn under it) and closes on 'gameStart' / 'gameOver'.
//
// Drawn into one canvas the size of the panel at device resolution; it repaints only when
// the text, the page marker or the open/close animation changes, re-wraps on resizes and
// redraws when the devicePixelRatio changes (checked every frame while shown, like the HUD).
// Without a DOM (node tests) the logic and events work the same, nothing is drawn.

import { DIALOG_FONT, DialogLogic, paginate, dialogMetrics, boxHeight, boxLines, boxTop, TYPING } from './dialogLogic.js';
import { SpriteCache, drawText, drawIcon } from './raster.js';
import { boxStyle } from './hudLogic.js';
import { pixelRatio } from './pixelRatio.js';

const OPEN_TIME = TYPING.openTicks / 30; // s: the box grows in while the typing waits
const CLOSE_TIME = 0.12; // s: fade-out after the last page
const BLINK_MS = 760; // page marker period

// Page markers: a down arrow while more pages follow, a diamond on the last page.
// (At most 7 font pixels wide: the text column always ends further left, see dialogMetrics.)
const ARROW = {
  w: 7,
  h: 6,
  rows: ['aaaaaaa', 'bbbbbbb', '.bbbbb.', '..ccc..', '..ccc..', '...c...'],
  palette: { a: '#fffbe0', b: '#ffd23c', c: '#f29a18' },
};
const END = {
  w: 7,
  h: 7,
  rows: ['...a...', '..aab..', '.aabbb.', 'abbbbbc', '.bbbcc.', '..bcc..', '...c...'],
  palette: { a: '#ffffff', b: '#9fe0ff', c: '#3f95d8' },
};

const PANEL_TOP = 'rgba(20,24,58,0.80)';
const PANEL_BOTTOM = 'rgba(6,8,26,0.84)';
const PANEL_EDGE = 'rgba(0,0,8,0.55)';
const PANEL_RIM = 'rgba(255,236,176,0.5)';
const PANEL_SHADOW = 'rgba(0,0,12,0.28)';

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const easeOutBack = (t) => {
  const c = 1.4;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

export class DialogBox {
  constructor(root, { events } = {}) {
    this.events = events;
    this.sign = null;
    this.pages = [];
    this.paused = false;
    this._tapped = false;
    this.logic = new DialogLogic({
      sfx: (name) => events?.emit('sfx', { name }),
      onClose: () => this._ended(false),
    });
    this._unsubs = events
      ? [
          events.on('signRead', (e) => this.open(e?.sign)),
          events.on('pause', () => this._setPaused(true)),
          events.on('unpause', () => this._setPaused(false)),
          events.on('gameStart', () => {
            this.paused = false; // a new game starts unpaused (main sends no 'unpause' then)
            this.close();
          }),
          events.on('gameOver', () => this.close()),
        ]
      : [];
    this.m = dialogMetrics(960, 540, 1);
    if (typeof document === 'undefined' || !root) return; // logic-only use (node tests)

    this.el = document.createElement('div');
    this.el.className = 'cg-dialog';
    this.el.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden;visibility:hidden';
    Object.assign(this.el.style, boxStyle(null));
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText =
      'position:absolute;display:block;pointer-events:auto;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent';
    this.el.appendChild(this.canvas);
    root.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d');
    this.cache = new SpriteCache();
    // A click on the box is a press; it must not also start a camera drag underneath.
    this.canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.isOpen && !this.paused) this._tapped = true;
    });
    this.canvas.addEventListener('mousedown', (e) => e.stopPropagation());
    this._resizeObserver = new ResizeObserver(() => this._layout());
    this._resizeObserver.observe(this.el);
    this._raf = 0;
    this._frame = (now) => {
      this._raf = 0;
      if (this._draw(now)) this._raf = requestAnimationFrame(this._frame);
    };
  }

  get isOpen() {
    return this.logic.isOpen;
  }

  // Current screen (0-based) and the page of the sign it belongs to.
  get screenIndex() {
    return this.logic.index;
  }

  get page() {
    return this.logic.screen.page;
  }

  open(sign) {
    if (!sign || this.isOpen) return;
    this.sign = sign;
    this.pages = Array.isArray(sign.pages) ? sign.pages : [String(sign.pages ?? '')];
    this._tapped = false;
    this.closing = null;
    this._measure();
    this.logic.open(this._paginate());
    this.openedAt = null; // set by the first frame, so the grow-in is never skipped
    this.completeAt = null;
    this._show();
  }

  update(c) {
    if (!this.isOpen) return;
    const pressed = !!(c?.A?.pressed || c?.B?.pressed || this._tapped);
    this._tapped = false;
    this.logic.tick(pressed);
  }

  close() {
    if (this.isOpen) {
      this.logic.close();
      this._ended(true);
    }
    this.closing = null;
    this._hide();
  }

  setViewport(vp) {
    if (this.el) Object.assign(this.el.style, boxStyle(vp));
  }

  dispose() {
    this.close();
    for (const off of this._unsubs) off();
    if (!this.el) return;
    cancelAnimationFrame(this._raf);
    this._resizeObserver.disconnect();
    this.el.remove();
  }

  // --- internals ------------------------------------------------------------------------

  _ended(cancelled) {
    const sign = this.sign;
    if (!cancelled && this.el) this.closing = { at: null }; // fade out, then hide
    else this._hide();
    this.events?.emit('dialogClosed', cancelled ? { sign, cancelled: true } : { sign });
  }

  _setPaused(paused) {
    this.paused = paused;
    if (!this.el) return;
    if (paused) this.el.style.visibility = 'hidden';
    else if (this.isOpen || this.closing) this._show();
  }

  _show() {
    if (!this.el || this.paused) return;
    this.el.style.visibility = 'visible';
    this._layout();
    this._key = null;
    if (!this._raf) this._raf = requestAnimationFrame(this._frame);
  }

  _hide() {
    if (!this.el) return;
    this.el.style.visibility = 'hidden';
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  // Metrics for the element's current size and device pixel ratio.
  _measure() {
    const dpr = pixelRatio();
    const w = this.el?.clientWidth || globalThis.innerWidth || 960;
    const h = this.el?.clientHeight || globalThis.innerHeight || 540;
    this.m = dialogMetrics(w, h, dpr);
    this.cssSize = [w, h];
    return this.m;
  }

  _paginate() {
    return paginate(this.pages, { wrap: this.m.wrap });
  }

  // Resize / new ratio: re-wrap (keeping the reading position) and place the canvas.
  _layout() {
    if (!this.el || !(this.isOpen || this.closing)) return;
    const prevWrap = this.m.wrap;
    const m = this._measure();
    if (m.wrap !== prevWrap && this.isOpen) this.logic.relayout(this._paginate());
    this.lines = boxLines(this.logic.screens);
    const h = boxHeight(m, this.lines);
    const margin = Math.ceil(4 * m.u); // room for the drop shadow and the grow-in overshoot
    const cw = m.w + 2 * margin;
    const ch = h + 2 * margin;
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.cache.clear();
    this.dpr = m.dpr;
    this.box = { x: margin, y: margin, w: m.w, h };
    // Whole device pixels, centred, in the upper part of the picture.
    const [W] = this.cssSize;
    const left = Math.round((W * m.dpr - m.w) / 2) - margin;
    const top = boxTop(m, h) - margin;
    Object.assign(this.canvas.style, {
      left: `${left / m.dpr}px`,
      top: `${top / m.dpr}px`,
      width: `${cw / m.dpr}px`,
      height: `${ch / m.dpr}px`,
    });
    this._key = null;
  }

  // One animation frame; returns false once there is nothing left to show.
  _draw(now) {
    if (!(this.isOpen || this.closing) || this.paused) return false;
    if (pixelRatio() !== this.dpr) this._layout();
    this.openedAt ??= now;
    let alpha = 1;
    let scale = 1;
    if (this.closing) {
      this.closing.at ??= now;
      const t = (now - this.closing.at) / 1000 / CLOSE_TIME;
      if (t >= 1) {
        this.closing = null;
        this._hide();
        return false;
      }
      alpha = 1 - t;
      scale = 1 - 0.04 * t;
    } else {
      const t = Math.min(1, (now - this.openedAt) / 1000 / OPEN_TIME);
      scale = 0.7 + 0.3 * easeOutBack(t);
      alpha = Math.min(1, t * 2);
    }
    const lg = this.logic;
    const complete = lg.complete;
    if (!complete) this.completeAt = null;
    else this.completeAt ??= now;
    const phase = complete ? (now - this.completeAt) % BLINK_MS : 0;
    const marker = !complete ? 'none' : lg.isLast ? `end${Math.round(this._endPulse(phase) * 8)}` : `arrow${this._arrowState(phase)}`;
    const key = `${lg.index}|${lg.count}|${marker}|${alpha}|${scale}|${this.canvas.width}x${this.canvas.height}`;
    if (key === this._key) return true;
    this._key = key;
    this._paint(alpha, scale, marker, phase);
    return true;
  }

  // Arrow: shown 70% of the period, one font pixel lower in its second half.
  _arrowState(phase) {
    if (phase >= BLINK_MS * 0.7) return 'off';
    return phase >= BLINK_MS * 0.35 ? 'low' : 'high';
  }

  // End marker: a slow glow between 0.35 and 1 (never fully gone).
  _endPulse(phase) {
    return 0.675 + 0.325 * Math.cos((phase / BLINK_MS) * Math.PI * 2);
  }

  _paint(alpha, scale, marker, phase) {
    const { ctx, box, m } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (scale !== 1) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }
    this._paintPanel();
    const lg = this.logic;
    let left = lg.count;
    lg.screen.lines.forEach((line, i) => {
      if (left <= 0) return;
      const shown = line.text.slice(0, left);
      left -= line.text.length;
      drawText(ctx, this.cache, DIALOG_FONT, shown, box.x + m.padX, box.y + m.padY + i * m.lineH, { px: m.fp, style: 'dialog' });
    });
    if (marker !== 'none') this._paintMarker(lg.isLast, phase);
    ctx.restore();
  }

  _paintPanel() {
    const { ctx, box, m } = this;
    const { x, y, w, h } = box;
    const r = m.radius;
    const edge = Math.max(1, Math.round(m.u * 0.75));
    // Soft drop shadow below.
    roundRect(ctx, x + edge, y + 2 * edge, w, h, r);
    ctx.fillStyle = PANEL_SHADOW;
    ctx.fill();
    // Body: a dark, see-through navy with a slight vertical fade.
    roundRect(ctx, x, y, w, h, r);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, PANEL_TOP);
    g.addColorStop(1, PANEL_BOTTOM);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = edge;
    ctx.strokeStyle = PANEL_EDGE;
    ctx.stroke();
    // A thin warm rim just inside the edge.
    const inset = edge * 2;
    roundRect(ctx, x + inset, y + inset, w - 2 * inset, h - 2 * inset, Math.max(0, r - inset));
    ctx.lineWidth = Math.max(1, Math.round(m.u * 0.5));
    ctx.strokeStyle = PANEL_RIM;
    ctx.stroke();
  }

  _paintMarker(last, phase) {
    const { ctx, box, m } = this;
    const icon = last ? END : ARROW;
    const px = m.fp;
    // Bottom-right corner, inside the rim and below the last line's letters.
    const x = box.x + box.w - Math.round(4 * m.u) - Math.round(icon.w * px);
    let y = box.y + box.h - Math.round(3.5 * m.u) - Math.round(icon.h * px);
    if (last) {
      ctx.globalAlpha *= this._endPulse(phase);
    } else {
      const state = this._arrowState(phase);
      if (state === 'off') return;
      if (state === 'high') y -= Math.round(px);
    }
    drawIcon(ctx, this.cache, icon, last ? 'dialogEnd' : 'dialogArrow', x, y, px);
  }
}
