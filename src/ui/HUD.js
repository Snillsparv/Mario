// N64-style HUD: lives (Jonas's face × n) top-left, coins and stars top-right, the power
// meter top-centre, a red-coin number pop-up and the pause screen. Everything is drawn into
// one canvas at device resolution from a 320x240 logical grid.
// While the cannon's aiming view is up ('cannonView' { on }, camera/cannon.js) a reticle marks
// the middle of the picture (where the barrel points) with a hint line under it (fire / climb
// out, in the bindings of the controls in use).
//
//   const hud = new HUD(uiRoot, { events });   // events optional (red-coin pop-ups)
//   hud.update({ lives, coins, stars, health, showPower, breath, paused })   // 30 Hz
//   hud.setPaused(bool)
//   hud.setVisible(bool)                        // e.g. hidden behind the title card
//   hud.setViewport({ x, y, width, height })   // picture rect in the root (4:3 pillarbox)
//
// Game logic (meter timing, counters) advances in update(); drawing runs on its own
// requestAnimationFrame loop and only repaints while something is changing. Counter bumps
// and the red-coin number age by frame time only while not paused, so they freeze with
// the game instead of running out behind the pause screen.

import { BIG_FONT, SMALL_FONT } from './bitmapFont.js';
import { ICONS } from './icons.js';
import { SpriteCache, drawText, drawIcon, textCanvas, textWidth } from './raster.js';
import { PowerMeterLogic, drawPowerMeter, isLowHealth } from './powerMeter.js';
import { hudMetrics, boxStyle, RollingCounter, MeterSlide, bumpCurve, redCoinCurve, BUMP_TIME } from './hudLogic.js';
import { drawPauseScreen, gamepadConnected, gamepadLegend } from './pauseScreen.js';
import { pixelRatio } from './pixelRatio.js';
import { touchUi } from './touchLogic.js';

const TICK = 1 / 30;
const MARGIN = 18; // logical px from the screen edge
const TOP = 13; // logical y of the icon row
const ICON = 14; // icon size without outline
const METER_R = 27; // power meter radius (logical px)
// The cannon's reticle (logical px): a ring, four ticks outside it, a dot in the middle.
const RETICLE = { r: 12, tick: [16, 23], light: '#f4e7c6', accent: '#39d6c8', dark: 'rgba(12,16,22,0.9)' };
// The hint under it, per controls legend kind: [key, action] pairs.
const CANNON_HINTS = {
  keys: [['Space / K', 'Fire'], ['J', 'Climb out']],
  pad: [['A', 'Fire'], ['B', 'Climb out']],
  touch: [['A', 'Fire'], ['B', 'Climb out']],
};

export class HUD {
  constructor(root, { events } = {}) {
    this.state = { lives: 4, coins: 0, stars: 0, health: 8, showPower: false, breath: 1 };
    this.meter = new PowerMeterLogic();
    this.coinCounter = new RollingCounter(0);
    this.paused = false;
    this.redCoins = 0; // fallback count when a red-coin event carries no index
    this.bumps = { lives: Infinity, coins: Infinity, stars: Infinity }; // seconds since each counter bumped
    this.redPopup = null; // { n, age }
    this.gamepad = false; // pause legend shows pad bindings
    this.controls = 'keys'; // pause legend: 'touch' (the touch controller is shown) | 'pad' | 'keys'
    this.slide = new MeterSlide();
    this.active = false; // nothing is drawn until the game first feeds state (not over the title)
    this.visible = true; // setVisible(): hidden HUDs skip their repaints
    this.dirty = true;
    this.unsub = events?.on('coin', (e) => {
      if (e?.red) this.showRedCoin(e.index);
    });
    this.cannonView = false; // the cannon's aiming view is up: reticle and hint
    this.cannonHints = 'keys';
    this.unsubCannon = events?.on('cannonView', (e) => this.setCannonView(!!e?.on));

    if (typeof document === 'undefined') return; // logic-only use (node tests)
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden';
    this.setViewport(null);
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;image-rendering:pixelated';
    this.el.appendChild(this.canvas);
    root.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d');
    this.cache = new SpriteCache();
    // Follows its own box, so window resizes, setViewport() and a root that is moved over
    // the picture (N64Renderer.alignOverlay) all re-layout the HUD.
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.el);
    this._resize();
    this._last = performance.now();
    this._frame = (now) => {
      this._draw(now);
      this._raf = requestAnimationFrame(this._frame);
    };
    this._raf = requestAnimationFrame(this._frame);
  }

  // 30 Hz: advance counters and meter timing from the game state.
  update(s) {
    const prev = this.state;
    this.state = { ...prev, ...s };
    if (typeof s.paused === 'boolean' && s.paused !== this.paused) this.setPaused(s.paused);
    if (this.state.lives !== prev.lives) this.bumps.lives = 0;
    if (this.state.stars > prev.stars) this.bumps.stars = 0;
    if (this.coinCounter.tick(this.state.coins)) this.bumps.coins = 0;
    this.meter.tick(this.state, TICK);
    // Repaint only when something on screen changes, not on every tick.
    const shown = [this.state.lives, this.coinCounter.shown, this.state.stars, this.meter.visible, this.meter.displayHealth].join();
    if (shown !== this._shown || !this.active) this.dirty = true;
    this._shown = shown;
    this.active = true;
  }

  setPaused(paused) {
    this.paused = !!paused;
    if (this.paused) {
      this.gamepad = gamepadConnected();
      this.controls = touchUi.active ? 'touch' : this.gamepad ? gamepadLegend() : 'keys';
    }
    this.dirty = true;
  }

  // Show or hide the whole HUD (the title and the game-over card use the screen alone).
  // While hidden the counters and the meter keep following update(), without repainting.
  setVisible(visible) {
    this.visible = !!visible;
    this.dirty = true; // repaint the current state when it shows again
    if (this.el) this.el.style.visibility = this.visible ? '' : 'hidden';
  }

  // Confine the HUD to the picture rectangle (CSS px relative to the root), e.g. the
  // renderer's 4:3 pillarbox viewport; null fills the whole root.
  setViewport(vp) {
    if (!this.el) return;
    Object.assign(this.el.style, boxStyle(vp));
  }

  // The cannon's aiming view went up / down (the reticle shows while it is up).
  setCannonView(on) {
    this.cannonView = !!on;
    if (this.cannonView) this.cannonHints = touchUi.active ? 'touch' : gamepadConnected() ? 'pad' : 'keys';
    this.dirty = true;
  }

  // Big number near the screen centre when a red coin is collected (1..8).
  showRedCoin(index) {
    this.redCoins = Number.isFinite(index) ? index : this.redCoins + 1;
    this.redPopup = { n: this.redCoins, age: 0 };
    this.dirty = true;
  }

  dispose() {
    this.unsub?.();
    this.unsubCannon?.();
    if (!this.el) return;
    cancelAnimationFrame(this._raf);
    this._resizeObserver.disconnect();
    this.el.remove();
  }

  _resize() {
    // The real ratio (no cap): a canvas stretched over more device pixels would blur the
    // pixel art, and it only repaints when something changes.
    const dpr = pixelRatio();
    this._dpr = dpr;
    const w = Math.round((this.el.clientWidth || innerWidth) * dpr);
    const h = Math.round((this.el.clientHeight || innerHeight) * dpr);
    if (w === this.canvas.width && h === this.canvas.height && this.s) return;
    this.canvas.width = w;
    this.canvas.height = h;
    const m = hudMetrics(this.canvas.width, this.canvas.height);
    this.s = m.scale; // device px per logical px
    this.W = m.W;
    this.H = m.H;
    this.cache.clear();
    this.dirty = true;
  }

  // Render-rate animation state; returns true while anything is still moving.
  _animate(dt) {
    const sliding = this.slide.step(this.meter.visible, dt);
    if (this.paused) return sliding; // bumps and the red-coin number wait for the game
    for (const k in this.bumps) this.bumps[k] += dt;
    const bumping = Object.values(this.bumps).some((age) => age < BUMP_TIME);
    if (this.redPopup) {
      this.redPopup.age += dt;
      if (!redCoinCurve(this.redPopup.age)) this.redPopup = null;
    }
    const pulsing = this.slide.t > 0 && isLowHealth(this.meter.displayHealth);
    return sliding || bumping || !!this.redPopup || pulsing;
  }

  _draw(now) {
    // A new devicePixelRatio with the same CSS size (the window moved to a monitor with
    // another scale) never reaches the ResizeObserver: re-layout at the new resolution.
    if (pixelRatio() !== this._dpr) this._resize();
    const dt = Math.max(0, Math.min(0.1, (now - this._last) / 1000));
    this._last = now;
    const moving = this._animate(dt);
    if (!this.active || !this.visible || (!moving && !this.dirty)) return;
    this.dirty = moving; // keep repainting until the last animation frame has settled
    const { ctx, s } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    if (this.paused) {
      const { coins, stars } = this.state;
      drawPauseScreen(ctx, this.cache, { W: this.W, H: this.H, s, coins, stars, controls: this.controls });
    }
    this._drawCounters();
    if (!this.paused) this._drawMeter(now);
    if (this.redPopup && !this.paused) this._drawRedCoin();
    if (this.cannonView && !this.paused) this._drawReticle();
  }

  // The cannon's reticle in the middle of the picture: a pixel ring with a dark outline, four
  // teal ticks round it and a dot, and the fire / climb-out hint low on the screen.
  _drawReticle() {
    const { ctx, cache, s, W, H } = this;
    const R = RETICLE;
    const cx = Math.round(W / 2);
    const cy = Math.round(H / 2);
    const px = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round((cx + x) * s), Math.round((cy + y) * s), Math.ceil(s), Math.ceil(s));
    };
    // Rings: the outline (two px wide) under the light one.
    const reach = R.r + 2;
    for (const [band, color] of [[1.5, R.dark], [0.55, R.light]]) {
      for (let y = -reach; y <= reach; y++) {
        for (let x = -reach; x <= reach; x++) if (Math.abs(Math.hypot(x, y) - R.r) <= band) px(x, y, color);
      }
    }
    // Ticks (outlined), the dot.
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let k = R.tick[0] - 1; k <= R.tick[1] + 1; k++) {
        for (let w = -1; w <= 1; w++) px(dx * k + dy * w, dy * k + dx * w, R.dark);
      }
      for (let k = R.tick[0]; k <= R.tick[1]; k++) px(dx * k, dy * k, R.accent);
    }
    for (let y = -2; y <= 1; y++) for (let x = -2; x <= 1; x++) px(x, y, R.dark);
    for (let y = -1; y <= 0; y++) for (let x = -1; x <= 0; x++) px(x, y, R.light);
    // Hint line near the bottom: key in gold, action in white, the pairs spaced apart.
    const hints = CANNON_HINTS[this.cannonHints] ?? CANNON_HINTS.keys;
    const gap = 4 * s;
    const spacing = 14 * s;
    const widths = hints.map(([k, a]) => textWidth(SMALL_FONT, k, s) + gap + textWidth(SMALL_FONT, a, s));
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (hints.length - 1);
    let x = Math.round((W / 2) * s - total / 2);
    const y = Math.round((H - 26) * s);
    // On a dark translucent strip, readable over the barrel and the sky alike.
    const padX = 6 * s;
    const padY = 3 * s;
    ctx.fillStyle = 'rgba(8,10,40,0.62)';
    ctx.fillRect(x - padX, y - padY, total + 2 * padX, SMALL_FONT.height * s + 2 * padY);
    hints.forEach(([key, action], i) => {
      drawText(ctx, cache, SMALL_FONT, key, x, y, { px: s, style: 'key' });
      drawText(ctx, cache, SMALL_FONT, action, x + textWidth(SMALL_FONT, key, s) + gap, y, { px: s, style: 'white' });
      x += widths[i] + spacing;
    });
  }

  // Icon × number, with an optional bump (hop + scale) on the number.
  _counter(icon, name, value, x, bumpAge) {
    const { ctx, cache, s } = this;
    drawIcon(ctx, cache, icon, name, x * s, TOP * s, s);
    const tx = (x + ICON + 2) * s;
    const ty = (TOP + 2) * s;
    drawText(ctx, cache, BIG_FONT, '×', tx, ty, { px: s });
    const { hop, scale } = bumpCurve(bumpAge);
    const nx = tx + 8 * s;
    if (scale === 1) {
      drawText(ctx, cache, BIG_FONT, String(value), nx, ty, { px: s, fixedDigits: true });
      return;
    }
    ctx.save();
    ctx.translate(nx, ty + 10 * s);
    ctx.scale(scale, scale);
    drawText(ctx, cache, BIG_FONT, String(value), 0, -10 * s - hop * 3 * s, { px: s, fixedDigits: true });
    ctx.restore();
  }

  _drawCounters() {
    const { W } = this;
    const st = this.state;
    const groupW = (digits) => ICON + 2 + 8 + digits * 9 - 1; // icon, gap, ×, digits
    this._counter(ICONS.hero, 'hero', Math.max(0, st.lives), MARGIN, this.bumps.lives);
    const starX = W - MARGIN - groupW(2);
    const coinX = starX - 10 - groupW(3);
    this._counter(ICONS.coin, 'coin', this.coinCounter.shown, coinX, this.bumps.coins);
    this._counter(ICONS.star, 'star', st.stars, starX, this.bumps.stars);
  }

  _drawMeter(now) {
    if (this.slide.t <= 0) return;
    const { ctx, s, W } = this;
    const cyShown = TOP + METER_R - 1;
    const cyHidden = -METER_R - 6;
    const cy = cyHidden + (cyShown - cyHidden) * this.slide.drop;
    const health = this.meter.displayHealth;
    let r = METER_R;
    let flash = 0;
    if (isLowHealth(health)) {
      const p = 0.5 + 0.5 * Math.sin((now / 1000) * Math.PI * 4);
      r *= 1 + 0.06 * p;
      flash = p;
    }
    drawPowerMeter(ctx, (W / 2) * s, cy * s, r * s, health, flash);
  }

  // The number is rendered opaque once into its own canvas and faded as a whole, so the
  // outline never shows through the fill while it fades.
  _drawRedCoin() {
    const c = redCoinCurve(this.redPopup.age);
    if (!c) return;
    const { ctx, s, W, H } = this;
    const px = s * 3;
    const key = `${this.redPopup.n}|${px}`;
    if (this._redSprite?.key !== key) {
      this._redSprite = { key, canvas: textCanvas(BIG_FONT, String(this.redPopup.n), px, 'red') };
    }
    const img = this._redSprite.canvas;
    ctx.save();
    ctx.globalAlpha = c.alpha;
    ctx.translate((W / 2) * s, (H * 0.4 - c.rise * 24) * s);
    ctx.scale(c.scale, c.scale);
    ctx.drawImage(img, -Math.round(img.width / 2), -Math.round(img.height / 2));
    ctx.restore();
  }
}
