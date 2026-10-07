// The game choice, the first screen (before the title card, see main's runTitle): CHOOSE YOUR
// GAME over the live grounds, with WITH AI RACE and WITHOUT AI RACE (ui/raceChoice.js) stacked
// in the middle, the picked one gold in a framed box, and a line saying what it means.
//
//   const { aiRace } = await new ChoiceScreen(uiRoot, { events, audio, aiRace }).show();
//
// Picking: up / down or left / right (arrows, W / S, A / D; Tab switches), a gamepad's d-pad or
// left stick (a fresh push). Each pick emits 'aiRaceChoice' { on } (main shows or hides the
// button behind the screen at once and remembers it) and sfx 'menu_move'.
// Playing the picked one: Enter / Space / Esc, gamepad Start or a face button, the phone's START
// or A, the touch controller's START or A; a click or tap on an option picks it and plays it.
// A key or click is a user gesture, so it also unlocks audio (the title card then plays its
// music and asks for Start at once). Then sfx 'menu_select', a 0.3 s fade, and show() resolves
// once the press is released too (the title card never sees it).
// Touch screens: the touch controller covers the screen, so its 'touchPress' { x, y } is
// hit-tested against the options.

import { injectStyles, hasBeenActive } from './dom.js';
import { BIG_FONT, SMALL_FONT } from './bitmapFont.js';
import { textCanvas } from './raster.js';
import { hudMetrics } from './hudLogic.js';
import { pixelRatio } from './pixelRatio.js';
import { touchUi } from './touchLogic.js';
import { Piece } from './TitleScreen.js';
import { RACE_CHOICES, RACE_TEXTS, choiceForKey } from './raceChoice.js';

const PLAY_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'Escape']);
const PAD_PLAY = [9, 0, 1, 2]; // Start and the face buttons of any pad layout (as the title card)
const PAD_UP = 12; // d-pad (standard mapping)
const PAD_DOWN = 13;
const PAD_LEFT = 14;
const PAD_RIGHT = 15;
const STICK_PICK = 0.6; // left stick past this picks (once per push)
const TOUCH_PLAY = new Set(['START', 'A']); // touch controller / phone buttons that play
const FADE_MS = 300;
const RELEASE_TIMEOUT_MS = 2000; // never wait forever for a key-up that got lost (blur)
const OPTION_PAD = 3; // logical px of padding around an option's label (and its border)

const CSS = `
.cg-choose { position:absolute; inset:0; overflow:hidden; user-select:none; -webkit-user-select:none;
  pointer-events:auto; touch-action:manipulation; -webkit-tap-highlight-color:transparent;
  background: radial-gradient(ellipse at 50% 50%, rgba(0,0,24,0.2) 25%, rgba(0,0,24,0.6) 100%);
  transition: opacity ${FADE_MS}ms ease-in; }
.cg-choose.cg-out { opacity:0; }
.cg-choose canvas { display:block; image-rendering:pixelated; }
.cg-c-head, .cg-c-list, .cg-c-about, .cg-c-prompt { position:absolute; left:50%; transform:translateX(-50%); }
.cg-c-list { display:flex; flex-direction:column; align-items:stretch; }
.cg-c-opt { display:flex; justify-content:center; box-sizing:border-box; cursor:pointer;
  border:max(1px, calc(var(--u) * 0.75)) solid transparent; border-radius:calc(var(--u) * 3);
  transition:background 0.12s, border-color 0.12s; }
.cg-c-opt.cg-sel { background:rgba(8,10,40,0.78); border-color:rgba(255,230,150,0.9); }
.cg-c-opt canvas { pointer-events:none; }
.cg-c-opt .cg-c-gold, .cg-c-opt.cg-sel .cg-c-white { display:none; }
.cg-c-opt.cg-sel .cg-c-gold { display:block; }
.cg-c-opt:not(.cg-sel) .cg-c-white { opacity:0.65; }
.cg-c-opt:not(.cg-sel):hover .cg-c-white { opacity:0.95; }
.cg-c-about { opacity:0.9; }
.cg-c-about[hidden] { display:none; }
`;

function pads() {
  return typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p?.connected) : [];
}

export class ChoiceScreen {
  constructor(root, { events, audio, aiRace = true } = {}) {
    this.root = root;
    this.events = events;
    this.audio = audio;
    this.aiRace = aiRace !== false;
    this.el = null;
  }

  show() {
    return new Promise((resolve) => {
      injectStyles('cg-choose-css', CSS);
      this.el = document.createElement('div');
      this.el.className = 'cg-choose';
      this.root.appendChild(this.el);
      this._build();
      this._layout();

      let done = false;
      let rafId = 0;
      const cleanups = [];
      const listen = (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts);
        cleanups.push(() => target.removeEventListener(type, fn, opts));
      };

      // Play the picked option; `released` resolves when the press that did it is let go.
      const play = (released, gesture) => {
        if (done) return;
        done = true;
        if (gesture && hasBeenActive() !== false) this.audio?.unlock?.();
        this.events?.emit('sfx', { name: 'menu_select' });
        this.el.classList.add('cg-out');
        const faded = new Promise((r) => setTimeout(r, FADE_MS));
        const timeout = new Promise((r) => setTimeout(r, FADE_MS + RELEASE_TIMEOUT_MS));
        Promise.all([faded, Promise.race([released, timeout])]).then(() => {
          cancelAnimationFrame(rafId);
          cleanups.forEach((fn) => fn());
          this.el.remove();
          this.el = null;
          resolve({ aiRace: this.aiRace });
        });
      };

      // Keyboard, capture phase on window: the game's Input never sees these keys.
      let keyHeld = null;
      listen(
        window,
        'keydown',
        (e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          const pick = choiceForKey(e.code, this.aiRace);
          const playKey = PLAY_KEYS.has(e.code);
          if (pick === null && !playKey) return;
          e.preventDefault(); // (Tab: no focus move; Space: no scroll)
          e.stopImmediatePropagation();
          if (done || e.repeat) return;
          if (pick !== null) this._choose(pick);
          else play(new Promise((r) => (keyHeld = { code: e.code, r })), true);
        },
        true,
      );
      listen(window, 'keyup', (e) => {
        if (keyHeld && e.code === keyHeld.code) keyHeld.r();
      });

      // A click on an option picks it and plays it.
      for (const opt of this.options) {
        listen(opt.el, 'click', () => {
          if (done) return;
          this._choose(opt.on);
          play(Promise.resolve(), true);
        });
      }

      if (this.events) {
        // The touch controller covers the screen: a tap on an option picks and plays it, its
        // START / A plays the picked one. Touch grants activation only when the finger lifts,
        // so audio is left to the title card, which unlocks it itself.
        let touchHeld = null;
        cleanups.push(
          this.events.on('touchPress', (e) => {
            if (!e || done) return;
            const hit = e.picture ? this._optionAt(e.x, e.y) : null;
            if (hit) this._choose(hit.on);
            if (hit || TOUCH_PLAY.has(e.button)) play(new Promise((r) => (touchHeld = { button: e.button, r })), false);
          }),
          this.events.on('touchRelease', (e) => {
            if (touchHeld && e?.button === touchHeld.button) touchHeld.r();
          }),
          this.events.on('touchUi', () => this._setTouch(touchUi.active)),
        );
        // A phone used as the controller: START / A play the picked one.
        let remoteHeld = null;
        cleanups.push(
          this.events.on('remotePress', (e) => {
            if (!e || done || !TOUCH_PLAY.has(e.button)) return;
            play(new Promise((r) => (remoteHeld = { button: e.button, r })), false);
          }),
          this.events.on('remoteRelease', (e) => {
            if (remoteHeld && e?.button === remoteHeld.button) remoteHeld.r();
          }),
        );
      }

      // Gamepads, polled every frame: a fresh push on the d-pad or stick picks, a fresh Start /
      // face button plays (buttons already held when the screen appeared wait for a release).
      const held = this._padButtons();
      let dir = this._padDirection();
      let padRelease = null;
      const poll = () => {
        if (pixelRatio() !== this._dpr) this._layout();
        const down = this._padButtons();
        for (const k of held) if (!down.has(k)) held.delete(k);
        const d = this._padDirection();
        if (!done && d !== dir && d !== 0) this._choose(RACE_CHOICES[d < 0 ? 0 : 1].on);
        dir = d;
        if (!done) {
          const fresh = [...down].find((k) => !held.has(k));
          if (fresh) play(new Promise((r) => (padRelease = { key: fresh, r })), false);
        } else if (padRelease && !down.has(padRelease.key)) {
          padRelease.r();
        }
        rafId = requestAnimationFrame(poll);
      };
      rafId = requestAnimationFrame(poll);

      const observer = new ResizeObserver(() => this._layout());
      observer.observe(this.el);
      cleanups.push(() => observer.disconnect());
    });
  }

  // Pick the option `on` (true: with the AI RACE button): highlight it and tell main.
  _choose(on) {
    on = !!on;
    if (on === this.aiRace) return;
    this.aiRace = on;
    this._mark();
    this.events?.emit('sfx', { name: 'menu_move' });
    this.events?.emit('aiRaceChoice', { on });
  }

  _mark() {
    for (const opt of this.options) {
      const picked = opt.on === this.aiRace;
      opt.el.classList.toggle('cg-sel', picked);
      opt.el.setAttribute('aria-pressed', String(picked));
      opt.about.el.hidden = !picked;
    }
  }

  // The option under the client point (x, y), or null.
  _optionAt(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    for (const opt of this.options) {
      const r = opt.el.getBoundingClientRect();
      if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return opt;
    }
    return null;
  }

  // "padIndex:button" for every play button held on any pad.
  _padButtons() {
    const out = new Set();
    for (const p of pads()) for (const b of PAD_PLAY) if (p.buttons[b]?.pressed) out.add(`${p.index}:${b}`);
    return out;
  }

  // -1 (up / left: the first option), 1 (down / right: the second) or 0.
  _padDirection() {
    for (const p of pads()) {
      const x = p.axes?.[0] ?? 0;
      const y = p.axes?.[1] ?? 0;
      if (p.buttons[PAD_UP]?.pressed || p.buttons[PAD_LEFT]?.pressed || y < -STICK_PICK || x < -STICK_PICK) return -1;
      if (p.buttons[PAD_DOWN]?.pressed || p.buttons[PAD_RIGHT]?.pressed || y > STICK_PICK || x > STICK_PICK) return 1;
    }
    return 0;
  }

  _build() {
    const text = (className, font, str, scale, style) => new Piece(`cg-pixel ${className}`, (px) => textCanvas(font, str, scale * px, style));
    this.pieces = {
      head: text('cg-c-head', BIG_FONT, RACE_TEXTS.title, 1.2, 'gold'),
      prompt: text('cg-c-prompt', SMALL_FONT, RACE_TEXTS.prompt, 1, 'white'),
    };
    this.list = document.createElement('div');
    this.list.className = 'cg-c-list';
    this.options = RACE_CHOICES.map(({ on, label, about }, i) => {
      const gold = text('cg-c-gold', BIG_FONT, label, 1, 'gold');
      const white = text('cg-c-white', BIG_FONT, label, 1, 'white');
      const line = text('cg-c-about', SMALL_FONT, about, 1, 'white');
      Object.assign(this.pieces, { [`opt${i}Gold`]: gold, [`opt${i}White`]: white, [`about${i}`]: line });
      const el = document.createElement('div');
      el.className = 'cg-c-opt';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${label}: ${about}`);
      el.append(gold.el, white.el);
      this.list.append(el);
      return { on, el, about: line };
    });
    this.touch = null;
    this._setTouch(touchUi.active, false);
    this.el.append(this.pieces.head.el, this.list, ...this.options.map((o) => o.about.el), this.pieces.prompt.el);
  }

  // Prompt for keys or for taps.
  _setTouch(on, relayout = true) {
    on = !!on;
    if (!this.pieces || on === this.touch) return;
    this.touch = on;
    const p = this.pieces.prompt;
    const str = on ? RACE_TEXTS.touchPrompt : RACE_TEXTS.prompt;
    p.render = (px) => textCanvas(SMALL_FONT, str, px, 'white');
    p.px = 0; // redraw at the next fit()
    if (relayout) this._layout();
  }

  // Size and place everything for the current box, in 320x240 logical units (as the title card),
  // centred on the picture.
  _layout() {
    const el = this.el;
    if (!el) return;
    const dpr = pixelRatio();
    this._dpr = dpr;
    const { scale: u, H } = hudMetrics(el.clientWidth || innerWidth, el.clientHeight || innerHeight);
    const px = u * dpr;
    const at = (v) => `${Math.round(v * u)}px`;
    el.style.setProperty('--u', `${u}px`);
    for (const piece of Object.values(this.pieces)) piece.fit(px, dpr);
    const optH = BIG_FONT.height + OPTION_PAD * 2;
    const gap = 4;
    const top = H / 2 - 58;
    this.pieces.head.el.style.top = at(top);
    this.list.style.top = at(top + 30);
    this.list.style.gap = at(gap);
    for (const opt of this.options) opt.el.style.padding = `${at(OPTION_PAD)} ${at(OPTION_PAD * 3)}`;
    const aboutTop = top + 30 + optH * 2 + gap + 16;
    for (const opt of this.options) opt.about.el.style.top = at(aboutTop);
    this.pieces.prompt.el.style.bottom = at(12);
    this._mark(); // a redrawn canvas is a new element: show the picked option's line again
  }
}
