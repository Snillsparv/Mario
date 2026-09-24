// Title card shown over the live 3D scene: an extruded, bevelled 'CASTLE GROUNDS' logo that
// drops in and gently bobs, 'starring PIP', a blinking PRESS START with the start keys
// spelled out, and a controls hint.
//
//   const title = new TitleScreen(uiRoot, { events, audio });
//   title.setViewport({ x, y, width, height });   // optional: picture rect (4:3 pillarbox)
//   await title.show();   // resolves after Enter / Space / Esc / click / tap / gamepad Start
//
// show() requests the 'title' track. Browsers only let audio start after a user gesture, so
// on a first visit the card first asks for any key/click/tap (PRESS ANY KEY): that press
// unlocks audio, starts the title music and reveals PRESS START, and is swallowed (it does
// not start the game). Without that step the Start press itself would unlock audio and
// start the game at once, and the title music would never be heard. The step is skipped
// when audio is muted, unavailable or already allowed (e.g. the title after a game over);
// gamepad presses are no user gesture, so a pad starts the game from either phase.
//
// On start: audio.unlock(), an sfx 'menu_select' event, a 0.4 s fade. The promise resolves
// only once the start key/button has been released too, so the game's own input never sees
// the same press (which would immediately toggle pause or jump).
//
// Touch screens (ui/TouchController.js shown): the prompts name taps and the on-screen START
// instead of keys, and the controller's START or A, or a touch on the picture, counts as a
// click on the card ('touchPress' / 'touchRelease' events); its first tap unlocks audio
// through the same pointer listeners as any tap.

import { BIG_FONT, SMALL_FONT } from './bitmapFont.js';
import { textCanvas } from './raster.js';
import { renderLogoWord } from './logo.js';
import {
  hudMetrics,
  boxStyle,
  TitleGate,
  START_PRESS,
  START_PROMPT,
  UNLOCK_PRESS,
  UNLOCK_PROMPT,
  TITLE_HINT,
  TOUCH_START_PROMPT,
  TOUCH_UNLOCK_PRESS,
  TOUCH_UNLOCK_PROMPT,
  TOUCH_TITLE_HINT,
} from './hudLogic.js';
import { pixelRatio } from './pixelRatio.js';
import { touchUi } from './touchLogic.js';

// Touch-controller buttons that start the game like a click on the card (any touch over the
// picture does too).
const TOUCH_START_BUTTONS = new Set(['START', 'A']);

// Escape is the in-game Start (pause) key, so it starts the game here too.
const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'Escape']);
const PAD_START_BUTTONS = [9, 0]; // standard mapping: Start, A
const FADE_MS = 400;
const RELEASE_TIMEOUT_MS = 2000; // never wait forever for a key-up that got lost (blur)

// Castle-and-lawn palette: brick and gold for CASTLE, grass and sky for GROUNDS.
const CASTLE_COLORS = ['#e4553a', '#f4b828'];
const GROUNDS_COLORS = ['#3cb44a', '#2a94dc'];
const PIP_COLORS = ['#20b0a0', '#f2b21e'];
// The smooth-shaded logo is first rendered at no more than this many device px per font
// pixel (its shading cost grows with the square of the size) and scaled up by CSS; a
// full-resolution render from the logo worker replaces it when it is ready.
const LOGO_MAX_CELL = 12;

const CSS = `
.cg-title { position:absolute; inset:0; overflow:hidden; cursor:pointer; user-select:none; pointer-events:auto;
  -webkit-user-select:none; touch-action:manipulation; -webkit-tap-highlight-color:transparent;
  background: radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,24,0.4) 100%);
  transition: opacity ${FADE_MS}ms ease-in; }
.cg-title.cg-out { opacity:0; }
.cg-title canvas { display:block; image-rendering:auto; }
.cg-title canvas.cg-pixel { image-rendering:pixelated; }
.cg-logo { position:absolute; left:50%; transform:translateX(-50%);
  display:flex; flex-direction:column; align-items:center;
  filter: drop-shadow(0 calc(var(--u) * 3) calc(var(--u) * 2) rgba(0,0,30,0.35)); }
.cg-bob { display:flex; flex-direction:column; align-items:center;
  animation: cg-drop 0.75s cubic-bezier(.2,1.5,.45,1) both, cg-bob 3.4s ease-in-out 0.75s infinite; }
.cg-starring { display:flex; align-items:center; justify-content:center; }
.cg-press, .cg-wake { position:absolute; left:50%; transform:translateX(-50%); }
.cg-press { animation: cg-blink 1.2s steps(1) infinite; }
.cg-out .cg-press { animation: cg-blink 0.12s steps(1) infinite; }
.cg-wake { animation: cg-pulse 2.4s ease-in-out infinite; }
.cg-prompt, .cg-hint { position:absolute; left:50%; transform:translateX(-50%); opacity:0.9; }
.cg-title.cg-locked .cg-if-ready, .cg-title:not(.cg-locked) .cg-if-locked { display:none; }
@keyframes cg-drop { from { transform: translateY(-60vh) scale(0.6); } to { transform: none; } }
@keyframes cg-bob {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(calc(var(--u) * -3)) rotate(-0.6deg); }
}
@keyframes cg-blink { 0% { opacity:1; } 62% { opacity:0; } }
@keyframes cg-pulse { 0%, 100% { opacity:1; } 50% { opacity:0.45; } }
`;

function injectStyles() {
  if (document.getElementById('cg-title-css')) return;
  const style = document.createElement('style');
  style.id = 'cg-title-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

const drift = (a, b) => Math.abs(a / b - 1);

// The page's sticky user activation (a key/click/tap happened, so browsers let audio
// start): true/false, or null where the browser does not report it.
function hasBeenActive() {
  const ua = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;
  return ua ? !!ua.hasBeenActive : null;
}

// One canvas-drawn part of the card. render(px) draws it at px device pixels per logical
// pixel; fit() shows it at the wanted scale and redraws only when that drifts more than
// `tolerance` (relative) from the scale it was drawn at, scaling with CSS in between.
// Bitmap text uses tolerance 0 so its pixels stay crisp. The logo tolerates 25%, renders
// synchronously at no more than maxPx and asks renderFull(px) (a promise of a canvas, or
// null) for the full-resolution version.
class Piece {
  constructor(className, render, { maxPx = Infinity, tolerance = 0, renderFull = null } = {}) {
    this.render = render;
    this.renderFull = renderFull;
    this.maxPx = maxPx;
    this.tolerance = tolerance;
    this.px = 0; // scale of the current canvas
    this.want = 0; // scale the layout asks for
    this.dpr = 1;
    this.el = document.createElement('canvas');
    this.el.className = className;
  }

  fit(px, dpr) {
    this.want = px;
    this.dpr = dpr;
    if (drift(px, this.px) > this.tolerance + 1e-6) {
      const drawn = Math.min(px, this.maxPx);
      this._swap(this.render(drawn), drawn);
      if (drawn < px && this.renderFull) this._upgrade(px);
    }
    this._size();
  }

  async _upgrade(px) {
    const canvas = await this.renderFull(px);
    // A resize may have moved on to a scale this render no longer suits.
    if (canvas && drift(this.want, px) <= this.tolerance + 1e-6) {
      this._swap(canvas, px);
      this._size();
    }
  }

  _swap(canvas, px) {
    canvas.className = this.el.className;
    canvas.style.cssText = this.el.style.cssText;
    this.el.replaceWith(canvas); // a no-op while not yet attached
    this.el = canvas;
    this.px = px;
  }

  _size() {
    const k = this.want / this.px / this.dpr; // CSS px per canvas px
    this.el.style.width = `${this.el.width * k}px`;
    this.el.style.height = `${this.el.height * k}px`;
  }
}

// Runs full-resolution logo renders in logoWorker.js. render() resolves to a canvas, or
// null when workers/OffscreenCanvas are unavailable or fail (the capped render then stays).
class LogoWorker {
  constructor() {
    this.pending = new Map();
    this.nextId = 0;
    this.worker = null;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./logoWorker.js', import.meta.url), { type: 'module' });
    } catch {
      return;
    }
    this.worker.onmessage = ({ data: { id, bitmap } }) => {
      const done = this.pending.get(id);
      this.pending.delete(id);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      done?.(canvas);
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.dispose();
    };
  }

  render(text, opts) {
    if (!this.worker) return Promise.resolve(null);
    const id = ++this.nextId;
    this.worker.postMessage({ id, text, opts });
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const done of this.pending.values()) done(null);
    this.pending.clear();
  }
}

export class TitleScreen {
  constructor(root, { events, audio } = {}) {
    this.root = root;
    this.events = events;
    this.audio = audio;
    this.el = null;
    this.viewport = null;
  }

  // Keep the card inside the picture rectangle (CSS px relative to the root), e.g. the
  // renderer's 4:3 pillarbox viewport; null fills the whole root.
  setViewport(vp) {
    this.viewport = vp;
    if (!this.el) return;
    Object.assign(this.el.style, boxStyle(vp));
  }

  show() {
    return new Promise((resolve) => {
      injectStyles();
      this.el = document.createElement('div');
      this.el.className = 'cg-title';
      this.setViewport(this.viewport);
      this.root.appendChild(this.el);
      this._build();
      this._layout();
      const audio = this.audio;
      audio?.playMusic?.('title');
      const gate = new TitleGate(this._audioLocked());
      this.el.classList.toggle('cg-locked', gate.locked);
      // Allowed already (e.g. a click while the page loaded) but not created yet: start it.
      if (!gate.locked && !audio?.ctx) audio?.unlock?.();

      let rafId = 0;
      const heldPad = this._pressedPadButtons(); // buttons already down when the title appeared
      const cleanups = [];
      const listen = (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts);
        cleanups.push(() => target.removeEventListener(type, fn, opts));
      };

      // The first press unlocked audio: start the title music and ask for Start.
      const wake = () => {
        this.el.classList.remove('cg-locked');
        audio?.unlock?.();
        audio?.playMusic?.('title'); // the context exists now, so the track starts at once
      };

      const begin = (released) => {
        this.el.classList.remove('cg-locked'); // PRESS START flickers out with the fade
        // A pad press is no user gesture: creating audio then would only log a warning.
        if (hasBeenActive() !== false) audio?.unlock?.();
        this.events?.emit('sfx', { name: 'menu_select' });
        this.el.classList.add('cg-out');
        const faded = new Promise((r) => setTimeout(r, FADE_MS));
        const timeout = new Promise((r) => setTimeout(r, FADE_MS + RELEASE_TIMEOUT_MS));
        Promise.all([faded, Promise.race([released, timeout])]).then(() => {
          cancelAnimationFrame(rafId);
          cleanups.forEach((fn) => fn());
          this.logoWorker.dispose();
          this.el.remove();
          this.el = null;
          resolve();
        });
      };

      // Keyboard: capture-phase on window so the game's Input (bubble phase) never sees
      // the start key; repeats of it are swallowed until the title is gone.
      let keyReleased = null;
      listen(
        window,
        'keydown',
        (e) => {
          const start = START_KEYS.has(e.code);
          if (start) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
          const act = gate.key({ start, repeat: e.repeat, activated: hasBeenActive() });
          if (act === 'unlock') wake();
          else if (act === 'begin') begin(new Promise((r) => (keyReleased = { code: e.code, r })));
        },
        true,
      );
      listen(window, 'keyup', (e) => {
        if (keyReleased && e.code === keyReleased.code) keyReleased.r();
      });
      // Pointer: any press on the page unlocks audio (mouse on press, touch/pen on release);
      // a click on the card starts, except the one that ends the unlocking press.
      const onPointer = (down) => () => {
        if ((down ? gate.pointerDown(hasBeenActive()) : gate.pointerUp(hasBeenActive())) === 'unlock') wake();
      };
      listen(window, 'pointerdown', onPointer(true), true);
      listen(window, 'pointerup', onPointer(false), true);
      listen(window, 'touchend', onPointer(false), true);
      listen(this.el, 'click', () => gate.click() === 'begin' && begin(Promise.resolve()));

      // The touch controller: START / A (or a touch over the picture) is a click on the card;
      // the game starts once that touch has ended. The pointer listeners above have already
      // seen the same touch (pointer events come first), so the unlocking tap is swallowed.
      if (this.events) {
        let touchHeld = null;
        cleanups.push(
          this.events.on('touchPress', (e) => {
            if (!e || !(TOUCH_START_BUTTONS.has(e.button) || e.picture) || gate.starting) return;
            if (gate.click() === 'begin') begin(new Promise((r) => (touchHeld = { button: e.button, r })));
          }),
          this.events.on('touchRelease', (e) => {
            if (touchHeld && e?.button === touchHeld.button) touchHeld.r();
          }),
          this.events.on('touchUi', () => this._setTouch(touchUi.active)),
        );
      }

      // Gamepad Start/A, polled every frame; waits for release like the keyboard path.
      let padRelease = null;
      const poll = () => {
        // A new devicePixelRatio with the same CSS size (the window moved to a monitor with
        // another scale) never reaches the ResizeObserver: redraw the card at it.
        if (pixelRatio() !== this._dpr) this._layout();
        // Unlocked by a gesture the card did not see (e.g. a handler that stopped the event).
        if (gate.locked && (hasBeenActive() === true || audio?.ctx?.state === 'running') && gate.unlock()) wake();
        const down = this._pressedPadButtons();
        for (const k of heldPad) if (!down.has(k)) heldPad.delete(k);
        if (!gate.starting) {
          const fresh = [...down].find((k) => !heldPad.has(k));
          if (fresh && gate.pad()) begin(new Promise((r) => (padRelease = { key: fresh, r })));
        } else if (padRelease && !down.has(padRelease.key)) {
          padRelease.r();
        }
        rafId = requestAnimationFrame(poll);
      };
      rafId = requestAnimationFrame(poll);

      // Follow the card's own box: window resizes and setViewport() (F3 pillarbox); poll()
      // follows the devicePixelRatio.
      const observer = new ResizeObserver(() => this._layout());
      observer.observe(this.el);
      cleanups.push(() => observer.disconnect());
    });
  }

  // Whether browser autoplay rules still hold the audio back: no key/click/tap on the page
  // yet (sticky activation), and audio is neither muted, unavailable nor already running.
  _audioLocked() {
    const a = this.audio;
    if (!a?.unlock || !a.playMusic || a.muted || a.failed) return false;
    if (typeof window === 'undefined' || !(window.AudioContext || window.webkitAudioContext)) return false;
    if (a.ctx?.state === 'running') return false;
    try {
      if (navigator.getAutoplayPolicy?.('audiocontext') === 'allowed') return false;
    } catch {
      // not supported: rely on the activation state
    }
    return hasBeenActive() !== true;
  }

  // Set of "padIndex:button" strings for start-capable buttons currently held.
  _pressedPadButtons() {
    const out = new Set();
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      for (const b of PAD_START_BUTTONS) if (p.buttons[b]?.pressed) out.add(`${p.index}:${b}`);
    }
    return out;
  }

  // Create the card's elements once; _layout() sizes and places them.
  _build() {
    this.logoWorker = new LogoWorker();
    const logoWord = (text, cell, opts) =>
      new Piece('', (px) => renderLogoWord(text, { cell: cell * px, ...opts }), {
        maxPx: LOGO_MAX_CELL / cell,
        tolerance: 0.25,
        renderFull: (px) => this.logoWorker.render(text, { cell: cell * px, ...opts }),
      });
    this.pieces = {
      castle: logoWord('CASTLE', 3.3, { colors: CASTLE_COLORS, arc: 0.32 }),
      grounds: logoWord('GROUNDS', 3.6, { colors: GROUNDS_COLORS, arc: 0.22 }),
      pip: logoWord('PIP', 2.2, { colors: PIP_COLORS, jitter: 0.08 }),
      starring: new Piece('cg-pixel', (px) => textCanvas(SMALL_FONT, 'starring', 1.5 * px, 'white')),
      press: new Piece('cg-press cg-if-ready cg-pixel', (px) => textCanvas(BIG_FONT, START_PRESS, 1.2 * px, 'gold')),
      prompt: new Piece('cg-prompt cg-if-ready cg-pixel', (px) => textCanvas(SMALL_FONT, START_PROMPT, px, 'white')),
      wake: new Piece('cg-wake cg-if-locked cg-pixel', (px) => textCanvas(BIG_FONT, UNLOCK_PRESS, 1.2 * px, 'gold')),
      wakePrompt: new Piece('cg-prompt cg-if-locked cg-pixel', (px) => textCanvas(SMALL_FONT, UNLOCK_PROMPT, px, 'white')),
      hint: new Piece('cg-hint cg-pixel', (px) => textCanvas(SMALL_FONT, TITLE_HINT, px, 'white')),
    };
    const div = (className, children) => {
      const d = document.createElement('div');
      d.className = className;
      d.append(...children);
      return d;
    };
    this.touch = null;
    this._setTouch(touchUi.active, false);
    const { castle, grounds, pip, starring, press, prompt, wake, wakePrompt, hint } = this.pieces;
    this.starringRow = div('cg-starring', [starring.el, pip.el]);
    this.logo = div('cg-logo', [div('cg-bob', [castle.el, grounds.el, this.starringRow])]);
    this.el.append(this.logo, press.el, prompt.el, wake.el, wakePrompt.el, hint.el);
  }

  // Prompts for keys/clicks or for the touch controller; redraws them when that changes.
  _setTouch(on, relayout = true) {
    on = !!on;
    if (!this.pieces || on === this.touch) return;
    this.touch = on;
    const { prompt, wake, wakePrompt, hint } = this.pieces;
    const text = (piece, font, str, scale, style) => {
      piece.render = (px) => textCanvas(font, str, scale * px, style);
      piece.px = 0; // redraw at the next fit()
    };
    text(prompt, SMALL_FONT, on ? TOUCH_START_PROMPT : START_PROMPT, 1, 'white');
    text(wake, BIG_FONT, on ? TOUCH_UNLOCK_PRESS : UNLOCK_PRESS, 1.2, 'gold');
    text(wakePrompt, SMALL_FONT, on ? TOUCH_UNLOCK_PROMPT : UNLOCK_PROMPT, 1, 'white');
    text(hint, SMALL_FONT, on ? TOUCH_TITLE_HINT : TITLE_HINT, 1, 'white');
    if (relayout) this._layout();
  }

  // Size and place everything for the current box; the layout is in 320x240 logical units.
  // Elements are kept (not rebuilt), so a resize never restarts the logo animation.
  _layout() {
    const el = this.el;
    if (!el) return;
    const dpr = pixelRatio(); // uncapped, so the pixel text is never stretched
    this._dpr = dpr;
    const { scale: u, H } = hudMetrics(el.clientWidth || innerWidth, el.clientHeight || innerHeight);
    const px = u * dpr; // device px per logical px
    const at = (v) => `${Math.round(v * u)}px`;
    el.style.setProperty('--u', `${u}px`);
    const p = this.pieces;
    for (const piece of Object.values(p)) piece.fit(px, dpr);
    this.logo.style.top = at(12);
    p.grounds.el.style.marginTop = at(-16);
    p.pip.el.style.marginLeft = at(-2);
    this.starringRow.style.marginTop = at(-8);
    p.press.el.style.top = p.wake.el.style.top = at(H * 0.73);
    p.prompt.el.style.top = p.wakePrompt.el.style.top = at(H * 0.73 + 16);
    p.hint.el.style.bottom = at(8);
  }
}
