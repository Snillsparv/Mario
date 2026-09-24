// On-screen game controller for touch screens: an original retro console-controller look (a
// moulded two-grip body in portrait, translucent overlays in landscape) that feeds the
// virtual controller through input.setTouchState (see docs/ARCHITECTURE.md "Winged hat,
// minions, locked castle, touch controller").
//
//   new TouchController({ input, events, view })   // main.js; shows itself on touch screens
//   tc.shown; tc.setVisible(bool); tc.layout (ui/touchLogic.js touchLayout); tc.dispose()
//
// Shown when the primary pointer is coarse (phones, tablets) or with ?touch=1 (?touch=0
// never); on other screens it also appears on the first touch of the page. Hidden, it adds
// nothing to the page but a display:none root.
//
// Portrait: the game picture keeps the top of the screen (the controller sets #game's bottom
// inset, so the renderer's ResizeObserver shrinks the picture and the #ui overlay follows it
// through alignOverlay) and the controller body fills the bottom ~42%: thumb stick and D-pad
// on the left grip, JUMP (A), ATTACK (B) and the CROUCH (Z) trigger on the right, the four
// camera buttons (C) top right, CAM (R) and START in the middle. Landscape: the picture fills
// the screen and the same controls float over its corners, translucent; a touch anywhere in
// the lower left starts the stick there.
//
// Touch handling: every touch keeps its identifier's role from where it started (stick,
// D-pad or a button). A button touch holds the button it started on and also the one it slides
// onto (a rolling thumb: Z then A for a backflip or long jump). A drag on the picture itself
// orbits the camera (input.addLookDelta). Presses vibrate briefly where supported. The page
// cannot scroll, zoom or open long-press menus while the controller is shown.
//
// Events: 'touchPress' { button, picture } on each new touch (button: a controller button
// name, 'stick', 'dpad' or 'none'; picture: the touch is over the game picture) and
// 'touchRelease' { button } when it ends (the title screen starts from them), 'touchUi'
// { shown } when the controller appears or goes.

import {
  touchLayout,
  touchRole,
  buttonAt,
  inWell,
  stickVector,
  dpadVector,
  wantTouchUi,
  touchUi,
  TOUCH_BUTTONS,
} from './touchLogic.js';

const LOOK_GAIN = 1.15; // camera orbit per px dragged on the picture, relative to a mouse drag
const VIBRATE_MS = 10;

// Letters / glyphs on the buttons and the embossed labels next to them (portrait).
const FACES = { A: 'A', B: 'B', Z: 'Z', R: 'CAM', START: 'START' };
const LABELS = { A: 'JUMP', B: 'ATTACK', Z: 'CROUCH', R: 'CAM', START: 'START' };
const ARROWS = { CU: 0, CR: 90, CD: 180, CL: 270 }; // arrow glyph rotation (deg)

const CSS = `
.cg-touch { position:fixed; inset:0; z-index:20; display:none; pointer-events:none; overflow:hidden;
  user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; -webkit-tap-highlight-color:transparent;
  touch-action:none; font-family: "Trebuchet MS", "Segoe UI", system-ui, sans-serif; }
.cg-touch.cg-on { display:block; }
html.cg-touch-on, html.cg-touch-on body { touch-action:none; overscroll-behavior:none; -webkit-user-select:none;
  user-select:none; -webkit-touch-callout:none; -webkit-text-size-adjust:none; }
html.cg-touch-on #game { touch-action:none; }
.cg-touch * { box-sizing:border-box; pointer-events:none; }
.cg-touch .cg-tc-zone { position:absolute; pointer-events:auto; touch-action:none; }
.cg-tc-body { position:absolute; left:0; top:0; overflow:visible; }
.cg-touch.cg-land .cg-tc-body, .cg-touch.cg-land .cg-tc-socket, .cg-touch.cg-land .cg-tc-label,
.cg-touch.cg-land .cg-tc-emblem { display:none; }

.cg-tc-socket { position:absolute; border-radius:50%; background:#15161d;
  box-shadow: inset 0 3px 5px rgba(0,0,0,0.75), 0 1px 0 rgba(255,255,255,0.10); }
.cg-tc-socket.cg-pill { border-radius:999px; }

.cg-tc-btn { position:absolute; border-radius:50%; display:flex; align-items:center; justify-content:center;
  color:rgba(255,255,255,0.94); font-weight:800; line-height:1; letter-spacing:0;
  text-shadow: 0 -1px 0 rgba(0,0,0,0.35), 0 1px 1px rgba(255,255,255,0.18);
  background: radial-gradient(circle at 36% 28%, var(--hi) 0, var(--c) 46%, var(--lo) 100%);
  box-shadow: 0 var(--d) 0 var(--edge), 0 calc(var(--d) + 3px) 7px rgba(0,0,0,0.5),
    inset 0 2px 2px rgba(255,255,255,0.45), inset 0 -3px 4px rgba(0,0,0,0.22);
  transform: translateY(0); transition: transform 50ms ease-out, box-shadow 50ms ease-out, filter 50ms; --d:4px; }
.cg-tc-btn.cg-down { transform: translateY(calc(var(--d) - 1px)); filter: brightness(0.9) saturate(1.1);
  box-shadow: 0 1px 0 var(--edge), 0 2px 3px rgba(0,0,0,0.5), 0 0 12px 3px rgba(120,240,225,0.55),
    inset 0 2px 3px rgba(0,0,0,0.25), inset 0 -1px 2px rgba(255,255,255,0.2); }
.cg-tc-btn.cg-pill { border-radius:999px; font-size:11px; letter-spacing:0.08em; --d:3px; }
.cg-tc-A { --c:#18a293; --hi:#7de8da; --lo:#0a5a52; --edge:#073f3a; }
.cg-tc-B { --c:#d6612a; --hi:#ffb987; --lo:#7a3110; --edge:#55200a; }
.cg-tc-Z { --c:#e1a92a; --hi:#ffe597; --lo:#8a620f; --edge:#5e420a;
  background: repeating-linear-gradient(90deg, rgba(0,0,0,0) 0 5px, rgba(0,0,0,0.10) 5px 6px, rgba(255,255,255,0.14) 6px 7px),
    radial-gradient(ellipse at 40% 25%, var(--hi) 0, var(--c) 50%, var(--lo) 100%); }
.cg-tc-R, .cg-tc-START { --c:#4d5162; --hi:#8a8fa6; --lo:#262833; --edge:#15161d; color:transparent; text-shadow:none; }

/* Camera rocker: one cream disc, rocking toward the pressed arrow (the four C buttons). */
.cg-tc-rock { position:absolute; border-radius:50%; transition: transform 50ms ease-out;
  background:
    linear-gradient(45deg, rgba(0,0,0,0) calc(50% - 1.5px), rgba(90,80,60,0.45) calc(50% - 1px), rgba(255,255,255,0.5) calc(50% + 1px), rgba(0,0,0,0) calc(50% + 1.5px)),
    linear-gradient(-45deg, rgba(0,0,0,0) calc(50% - 1.5px), rgba(90,80,60,0.45) calc(50% - 1px), rgba(255,255,255,0.5) calc(50% + 1px), rgba(0,0,0,0) calc(50% + 1.5px)),
    radial-gradient(circle at 50% 50%, #cfc6ad 0, #cfc6ad 17%, rgba(0,0,0,0) 18%),
    radial-gradient(circle at 38% 30%, #fffdf5 0, #e7dfc9 45%, #a89d7e 100%);
  box-shadow: 0 3px 0 #6e6550, 0 6px 8px rgba(0,0,0,0.5), inset 0 2px 2px rgba(255,255,255,0.6), inset 0 -3px 4px rgba(0,0,0,0.18); }
.cg-tc-rock-socket { position:absolute; border-radius:50%; background:#15161d;
  box-shadow: inset 0 3px 5px rgba(0,0,0,0.75), 0 1px 0 rgba(255,255,255,0.10); }
.cg-tc-btn.cg-tc-C { background:none; box-shadow:none; --d:0px; }
.cg-tc-btn.cg-tc-C.cg-down { filter:none; transform:none; box-shadow:none; }
.cg-tc-C svg { width:60%; height:60%; fill:#6a5f47; filter: drop-shadow(0 1px 0 rgba(255,255,255,0.75)); transition: fill 50ms; }
.cg-tc-C.cg-down svg { fill:#12887b; filter: drop-shadow(0 0 3px rgba(60,220,200,0.9)); }

.cg-tc-label { position:absolute; transform:translate(-50%, 0); white-space:nowrap; font-weight:800;
  color:#8e94ad; letter-spacing:0.14em; opacity:0.85;
  text-shadow: 0 -1px 0 rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.10); }
.cg-tc-emblem { position:absolute; transform:translate(-50%, -50%); display:flex; align-items:center; gap:0.6em;
  white-space:nowrap; font-weight:800; letter-spacing:0.16em; color:#7d8399;
  text-shadow: 0 -1px 0 rgba(0,0,0,0.75), 0 1px 0 rgba(255,255,255,0.12); }
.cg-tc-led { width:0.6em; height:0.6em; border-radius:50%; background:#4be0a0;
  box-shadow: 0 0 5px 1px rgba(75,224,160,0.8), inset 0 -1px 1px rgba(0,0,0,0.3); }

.cg-tc-well { position:absolute; border-radius:50%;
  background: radial-gradient(circle at 50% 42%, #1c1d25 0, #121319 62%, #0a0b0f 100%);
  box-shadow: inset 0 5px 12px rgba(0,0,0,0.8), inset 0 -1px 0 rgba(255,255,255,0.10), 0 1px 0 rgba(255,255,255,0.10); }
.cg-tc-well::after { content:''; position:absolute; inset:14%; border-radius:50%;
  border:1px dashed rgba(160,168,200,0.14); }
.cg-tc-knob { position:absolute; left:0; top:0; border-radius:50%;
  background: radial-gradient(circle at 50% 50%, rgba(0,0,0,0.28) 0, rgba(0,0,0,0) 38%),
    repeating-conic-gradient(rgba(255,255,255,0.07) 0 6deg, rgba(0,0,0,0.07) 6deg 12deg),
    radial-gradient(circle at 40% 32%, #9ca1b8 0, #62677d 38%, #3a3d4f 72%, #24262f 100%);
  box-shadow: 0 7px 12px rgba(0,0,0,0.6), 0 2px 0 #17181f, inset 0 2px 2px rgba(255,255,255,0.35), inset 0 -3px 5px rgba(0,0,0,0.35);
  transition: transform 90ms ease-out; will-change: transform; }
.cg-tc-knob.cg-drag { transition:none; box-shadow: 0 4px 8px rgba(0,0,0,0.6), 0 0 0 2px rgba(111,232,216,0.55),
  inset 0 2px 2px rgba(255,255,255,0.35), inset 0 -3px 5px rgba(0,0,0,0.35); }

.cg-tc-dpad { position:absolute; transition: transform 50ms ease-out; }
.cg-tc-dpad .cg-bar { position:absolute; border-radius:4px;
  background: linear-gradient(180deg, #555a6d 0, #3a3d4c 55%, #2a2c37 100%);
  box-shadow: 0 3px 0 #17181f, 0 5px 7px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.28); }
.cg-tc-dpad .cg-h { left:0; right:0; top:33%; bottom:33%; }
.cg-tc-dpad .cg-v { top:0; bottom:0; left:33%; right:33%; }
.cg-tc-dpad .cg-dot { position:absolute; left:50%; top:50%; width:22%; height:22%; transform:translate(-50%,-50%);
  border-radius:50%; background: radial-gradient(circle at 50% 60%, #2a2c37, #4a4e60); }
.cg-tc-dpad .cg-arrow { position:absolute; width:0; height:0; border:solid transparent; color:rgba(200,206,228,0.55); }
.cg-tc-dpad .cg-arrow.cg-lit { color:#7ff0e0; filter: drop-shadow(0 0 3px rgba(111,232,216,0.9)); }
.cg-touch.cg-land .cg-tc-dpad .cg-arrow { color:rgba(255,255,255,0.65); }
.cg-touch.cg-land .cg-tc-dpad .cg-arrow.cg-lit { color:#7ff0e0; }
.cg-tc-dpad-socket { position:absolute; border-radius:50%;
  background: radial-gradient(circle at 50% 45%, #1b1c24 0, #191a21 60%, #22242e 100%);
  box-shadow: inset 0 3px 7px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.08); }

.cg-touch.cg-land .cg-tc-btn { opacity:0.55; }
.cg-touch.cg-land .cg-tc-btn.cg-down { opacity:0.9; }
.cg-touch.cg-land .cg-tc-R, .cg-touch.cg-land .cg-tc-START { color:rgba(255,255,255,0.9); font-size:10px; }
.cg-touch.cg-land .cg-tc-well { background: radial-gradient(circle, rgba(10,12,20,0.18) 0, rgba(10,12,20,0.34) 100%);
  box-shadow: 0 0 0 2px rgba(255,255,255,0.22), inset 0 2px 8px rgba(0,0,0,0.35); opacity:0.8; }
.cg-touch.cg-land .cg-tc-knob { opacity:0.7; }
.cg-touch.cg-land .cg-tc-knob.cg-drag { opacity:0.9; }
.cg-touch.cg-land .cg-tc-dpad { opacity:0.55; }
.cg-touch.cg-land .cg-tc-dpad.cg-active { opacity:0.85; }
.cg-touch.cg-land .cg-tc-dpad-socket, .cg-touch.cg-land .cg-tc-rock-socket { display:none; }
.cg-touch.cg-land .cg-tc-rock { opacity:0.55; }
.cg-touch.cg-land .cg-tc-rock.cg-active { opacity:0.9; }
.cg-tc-rock.cg-active { box-shadow: 0 2px 0 #6e6550, 0 0 12px 3px rgba(120,240,225,0.5), inset 0 2px 2px rgba(255,255,255,0.6), inset 0 -3px 4px rgba(0,0,0,0.18); }
.cg-touch.cg-land .cg-tc-btn.cg-tc-C { opacity:1; }
/* Paused (landscape): the overlays fade back so the pause screen's legend reads; START stays. */
.cg-touch.cg-land.cg-paused > :not(.cg-tc-START):not(.cg-tc-zone) { opacity:0.14; transition: opacity 150ms; }
`;

function injectStyles() {
  if (document.getElementById('cg-touch-css')) return;
  const style = document.createElement('style');
  style.id = 'cg-touch-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

const px = (v) => `${Math.round(v * 10) / 10}px`;

function place(el, x, y, w, h) {
  el.style.left = px(x);
  el.style.top = px(y);
  el.style.width = px(w);
  el.style.height = px(h);
}

// The moulded body (portrait): one rounded slab across the screen whose lower edge dips into
// two grips, with a bevel along the top, a parting-line seam, a recessed centre plate and a
// shallow speaker grille. SVG markup for the body's box (local coordinates).
export function bodySvg(layout) {
  const { w: W, h } = layout.body;
  const top = 3;
  const r = Math.min(34, W * 0.09);
  const notch = layout.body.notchY - layout.body.y; // the middle of the lower edge
  const k = layout.k;
  const path = [
    `M${r},${top}`,
    `H${W - r}`,
    `Q${W},${top} ${W},${top + r}`,
    `V${h}`,
    `H${W * 0.67}`,
    `C${W * 0.61},${h} ${W * 0.6},${notch} ${W * 0.5},${notch}`,
    `C${W * 0.4},${notch} ${W * 0.39},${h} ${W * 0.33},${h}`,
    `H0`,
    `V${top + r}`,
    `Q0,${top} ${r},${top}`,
    'Z',
  ].join(' ');
  // The centre plate holds CAM and START (with their labels) and a small grille below.
  const { R, START } = layout.buttons;
  const plateW = 96 * k;
  const plateX = W / 2 - plateW / 2;
  const plateY = R.y - R.h / 2 - layout.body.y - 16 * k;
  const plateH = Math.min(notch - 10 * k, START.y + START.h / 2 - layout.body.y + 50 * k) - plateY;
  const seamY = top + 7;
  const grille = [];
  for (let i = 0; i < 3; i++) {
    const y = plateY + plateH - 20 * k + i * 5 * k;
    grille.push(`<rect x="${W / 2 - 14 * k}" y="${y}" width="${28 * k}" height="${2 * k}" rx="${k}" fill="#15161c" opacity="0.8"/>`);
  }
  return `
    <defs>
      <linearGradient id="cgBodyFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4a4f64"/>
        <stop offset="0.12" stop-color="#3a3e50"/>
        <stop offset="0.7" stop-color="#2c2f3d"/>
        <stop offset="1" stop-color="#1f2129"/>
      </linearGradient>
      <radialGradient id="cgGripL" cx="0.2" cy="0.95" r="0.5">
        <stop offset="0" stop-color="#000" stop-opacity="0.28"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="cgGripR" cx="0.8" cy="0.95" r="0.5">
        <stop offset="0" stop-color="#000" stop-opacity="0.28"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="cgPlate" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#262833"/><stop offset="1" stop-color="#2d303d"/>
      </linearGradient>
      <clipPath id="cgBodyClip"><path d="${path}"/></clipPath>
    </defs>
    <path d="${path}" fill="url(#cgBodyFill)"/>
    <g clip-path="url(#cgBodyClip)">
      <rect x="0" y="0" width="${W}" height="${h}" fill="url(#cgGripL)"/>
      <rect x="0" y="0" width="${W}" height="${h}" fill="url(#cgGripR)"/>
      <path d="M0,${seamY} H${W}" stroke="#15161c" stroke-width="1" opacity="0.7"/>
      <path d="M0,${seamY + 1} H${W}" stroke="#fff" stroke-width="1" opacity="0.06"/>
      <rect x="${plateX}" y="${plateY}" width="${plateW}" height="${plateH}" rx="${14 * k}" fill="url(#cgPlate)"
        stroke="#fff" stroke-opacity="0.07" stroke-width="1"/>
      <rect x="${plateX}" y="${plateY}" width="${plateW}" height="${plateH}" rx="${14 * k}" fill="none"
        stroke="#000" stroke-opacity="0.35" stroke-width="2" transform="translate(0,-1)"/>
      ${grille.join('')}
    </g>
    <path d="${path}" fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="1.5" transform="translate(0,0.75)"
      clip-path="url(#cgBodyClip)"/>
    <path d="${path}" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="1"/>`;
}

const ARROW_SVG = '<svg viewBox="-10 -10 20 20"><path d="M0,-7 L7,4 L-7,4 Z"/></svg>';

export class TouchController {
  // input: core/input.js Input; events: the game's bus; view: N64Renderer (its container is
  // the element whose bottom inset makes room in portrait). Options for previews/tests:
  // container (instead of view.container), search (instead of location.search), coarse.
  constructor({ input, events, view, container, search, coarse } = {}) {
    this.input = input;
    this.events = events;
    this.view = view;
    this.shown = false;
    this.layout = null;
    this.touches = []; // active touch records (see _begin)
    this.looks = []; // camera drags on the picture: { id, x, y }
    // Fed to input.setTouchState (reused).
    this.state = { stickX: 0, stickY: 0 };
    for (const b of TOUCH_BUTTONS) this.state[b] = false;
    this.lit = {}; // what each button shows (pressed or not)
    this.stickShown = { kx: NaN, ky: NaN, x: NaN, y: NaN, drag: null };
    this.dpadShown = 0; // D-pad state drawn: 0 = idle, 16 | direction bits while touched
    if (typeof document === 'undefined') return; // logic-only use (node tests)

    this.container = container ?? view?.container ?? document.getElementById('game');
    const query = search ?? location.search;
    this.forced = new URLSearchParams(query).get('touch');
    this.mq = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    this.wanted = () => wantTouchUi({ search: query, coarse: coarse ?? !!this.mq?.matches });

    injectStyles();
    this._build();
    this._listen();
    if (events) {
      const paused = (on) => () => this.root.classList.toggle('cg-paused', on);
      (this._offs ??= []).push(events.on('pause', paused(true)), events.on('unpause', paused(false)), events.on('gameStart', paused(false)));
    }
    if (this.wanted()) this.setVisible(true);
  }

  _build() {
    const root = (this.root = document.createElement('div'));
    root.className = 'cg-touch';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'cg-tc-body');
    this.zoneLayer = document.createElement('div');
    this.probe = document.createElement('div');
    this.probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    const div = (className, parent = root) => {
      const d = document.createElement('div');
      d.className = className;
      parent.appendChild(d);
      return d;
    };
    root.append(this.svg);
    this.emblem = div('cg-tc-emblem');
    this.emblem.innerHTML = '<span class="cg-tc-led"></span><span>CASTLE GROUNDS</span>';
    this.dpadSocket = div('cg-tc-dpad-socket');
    this.dpad = div('cg-tc-dpad');
    div('cg-bar cg-h', this.dpad);
    div('cg-bar cg-v', this.dpad);
    div('cg-dot', this.dpad);
    this.dpadArrows = {};
    for (const dir of ['up', 'down', 'left', 'right']) this.dpadArrows[dir] = div('cg-arrow', this.dpad);
    this.well = div('cg-tc-well');
    this.knob = div('cg-tc-knob');
    this.rockSocket = div('cg-tc-rock-socket');
    this.rock = div('cg-tc-rock');
    this.sockets = {};
    this.buttons = {};
    this.labels = {};
    for (const b of TOUCH_BUTTONS) {
      const isC = b in ARROWS;
      if (!isC) this.sockets[b] = div(`cg-tc-socket${b === 'A' || b === 'B' ? '' : ' cg-pill'}`);
      const el = div(`cg-tc-btn cg-tc-${isC ? 'C' : b}`);
      if (isC) {
        el.innerHTML = ARROW_SVG;
        el.firstChild.style.transform = `rotate(${ARROWS[b]}deg)`;
      } else {
        el.textContent = FACES[b];
      }
      this.buttons[b] = el;
      this.lit[b] = false;
      if (LABELS[b]) {
        this.labels[b] = div('cg-tc-label');
        this.labels[b].textContent = LABELS[b];
      }
    }
    this.cLabel = div('cg-tc-label');
    this.cLabel.textContent = 'CAMERA';
    root.append(this.zoneLayer, this.probe);
    document.body.appendChild(root);
  }

  _listen() {
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      (this._offs ??= []).push(() => target.removeEventListener(type, fn, opts));
    };
    const active = { passive: false };
    on(this.root, 'touchstart', (e) => this._onTouch(e, 'start'), active);
    on(this.root, 'touchmove', (e) => this._onTouch(e, 'move'), active);
    on(this.root, 'touchend', (e) => this._onTouch(e, 'end'), active);
    on(this.root, 'touchcancel', (e) => this._onTouch(e, 'end'), active);
    // A mouse on the controller (desktop with ?touch=1) works like one finger; it must not
    // also start the mouse-drag camera orbit (core/input.js listens on window).
    on(this.root, 'mousedown', (e) => e.stopPropagation());
    on(this.root, 'pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      e.preventDefault();
      this._mouse = true;
      this._pointer('start', 'mouse', e.clientX, e.clientY);
    });
    on(window, 'pointermove', (e) => this._mouse && e.pointerType === 'mouse' && this._pointer('move', 'mouse', e.clientX, e.clientY));
    on(window, 'pointerup', (e) => {
      if (!this._mouse || e.pointerType !== 'mouse') return;
      this._mouse = false;
      this._pointer('end', 'mouse', e.clientX, e.clientY);
    });
    // Drags on the picture orbit the camera.
    if (this.container) {
      on(this.container, 'touchstart', (e) => this._onLook(e, 'start'), active);
      on(this.container, 'touchmove', (e) => this._onLook(e, 'move'), active);
      on(this.container, 'touchend', (e) => this._onLook(e, 'end'), active);
      on(this.container, 'touchcancel', (e) => this._onLook(e, 'end'), active);
    }
    // iOS pinch-zoom gestures on the page.
    on(document, 'gesturestart', (e) => this.shown && e.preventDefault(), active);
    let raf = 0;
    const relayout = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (this.shown) this._layout();
      });
    };
    on(window, 'resize', relayout);
    on(window, 'orientationchange', relayout);
    on(window, 'blur', () => this.releaseAll());
    on(document, 'visibilitychange', () => document.hidden && this.releaseAll());
    if (this.mq?.addEventListener) on(this.mq, 'change', () => this.setVisible(this.wanted()));
    // A touch screen whose primary pointer is fine (a laptop): show on the first touch.
    if (this.forced !== '0' && this.forced !== 'false') {
      const first = () => !this.shown && this.setVisible(true);
      on(window, 'touchstart', first, { passive: true, once: true });
    }
  }

  setVisible(on) {
    on = !!on;
    if (!this.root || on === this.shown) return;
    this.shown = on;
    touchUi.active = on;
    this.root.classList.toggle('cg-on', on);
    document.documentElement.classList.toggle('cg-touch-on', on);
    if (on) this._layout();
    else {
      this.releaseAll();
      this._setPictureBottom(0);
    }
    this.events?.emit('touchUi', { shown: on });
  }

  // Let go of everything (window blur, hidden tab, controller hidden, new layout).
  releaseAll() {
    for (let i = 0; i < this.touches.length; i++) this.events?.emit('touchRelease', { button: this.touches[i].role });
    this.touches.length = 0;
    this.looks.length = 0;
    this._mouse = false;
    this._update();
  }

  dispose() {
    this.setVisible(false);
    for (const off of this._offs ?? []) off();
    this._offs = null;
    this.root?.remove();
  }

  // The game picture leaves `h` px free at the bottom of the screen (portrait) or none.
  _setPictureBottom(h) {
    const c = this.container;
    if (!c) return;
    const want = h > 0 ? `${h}px` : '';
    if (c.style.bottom === want) return;
    c.style.bottom = want;
    this.view?.refit?.(); // resize now (the ResizeObserver would a frame later)
  }

  _safeArea() {
    const cs = getComputedStyle(this.probe);
    const n = (v) => parseFloat(v) || 0;
    return { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
  }

  _layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const L = (this.layout = touchLayout(W, H, this._safeArea()));
    const land = L.mode === 'landscape';
    this.root.classList.toggle('cg-land', land);
    this._setPictureBottom(L.pictureBottom);
    const k = L.k;

    // Body (portrait).
    if (L.body) {
      place(this.svg, L.body.x, L.body.y, L.body.w, L.body.h);
      this.svg.setAttribute('viewBox', `0 0 ${L.body.w} ${L.body.h}`);
      this.svg.innerHTML = bodySvg(L);
      this.emblem.style.left = px(L.emblem.x);
      this.emblem.style.top = px(L.emblem.y);
      this.emblem.style.fontSize = px(7.5 * k);
    }

    // Zones that capture touches.
    this.zoneLayer.textContent = '';
    for (const z of L.zones) {
      const d = document.createElement('div');
      d.className = 'cg-tc-zone';
      place(d, z.x, z.y, z.w, z.h);
      this.zoneLayer.appendChild(d);
    }

    // Stick, D-pad.
    const s = L.stick;
    this._placeWell(s.x, s.y);
    place(this.knob, -s.knob, -s.knob, s.knob * 2, s.knob * 2);
    this.stickShown.kx = NaN;
    const d = L.dpad;
    place(this.dpad, d.x - d.size / 2, d.y - d.size / 2, d.size, d.size);
    const sock = d.size * 0.66;
    place(this.dpadSocket, d.x - sock, d.y - sock, sock * 2, sock * 2);
    const a = d.size * 0.1; // arrow size
    for (const [dir, el] of Object.entries(this.dpadArrows)) {
      el.style.borderWidth = px(a * 0.8);
      el.style.borderColor = 'transparent';
      const side = { up: 'Bottom', down: 'Top', left: 'Right', right: 'Left' }[dir];
      el.style[`border${side}Color`] = 'currentColor';
      el.style[`border${side}Width`] = px(a);
      const c = d.size / 2 - a * 0.8;
      const far = d.size * 0.08;
      if (dir === 'up') Object.assign(el.style, { left: px(c), top: px(far), right: '', bottom: '' });
      if (dir === 'down') Object.assign(el.style, { left: px(c), bottom: px(far), top: '', right: '' });
      if (dir === 'left') Object.assign(el.style, { top: px(c), left: px(far), right: '', bottom: '' });
      if (dir === 'right') Object.assign(el.style, { top: px(c), right: px(far), left: '', bottom: '' });
      el.style.width = el.style.height = '0';
    }
    this.dpadShown = null;

    // Buttons, their sockets and labels.
    for (const b of TOUCH_BUTTONS) {
      const shape = L.buttons[b];
      const el = this.buttons[b];
      if (shape.kind === 'circle') {
        place(el, shape.x - shape.r, shape.y - shape.r, shape.r * 2, shape.r * 2);
        el.style.transform = '';
        el.style.fontSize = px(shape.r * 0.95);
      } else {
        place(el, shape.x - shape.w / 2, shape.y - shape.h / 2, shape.w, shape.h);
        el.style.rotate = shape.rot ? `${shape.rot}deg` : '';
        el.style.fontSize = px(b === 'Z' ? shape.h * 0.62 : shape.h * 0.46);
      }
      el.classList.toggle('cg-pill', shape.kind === 'pill');
      const sockEl = this.sockets[b];
      if (sockEl) {
        const g = 4 * k; // the socket's rim around the button
        if (shape.kind === 'circle') place(sockEl, shape.x - shape.r - g, shape.y - shape.r - g + 2 * k, (shape.r + g) * 2, (shape.r + g) * 2);
        else place(sockEl, shape.x - shape.w / 2 - g, shape.y - shape.h / 2 - g + 2 * k, shape.w + 2 * g, shape.h + 2 * g);
        sockEl.style.rotate = shape.rot ? `${shape.rot}deg` : '';
      }
      const label = this.labels[b];
      if (label) {
        const below = shape.kind === 'circle' ? shape.r : shape.h / 2;
        const extra = b === 'Z' ? 10 * k : 0;
        label.style.left = px(shape.x + (b === 'Z' ? -8 * k : 0));
        label.style.top = px(shape.y + below + 7 * k + extra);
        label.style.fontSize = px(9 * k);
      }
    }
    const cu = L.buttons.CU;
    const cd = L.buttons.CD;
    const rr = cd.y - cu.y; // rocker diameter: spread * 2 ...
    const rockR = rr / 2 + cu.r * 0.95; // ... plus the arrows' pads
    const rcy = (cu.y + cd.y) / 2;
    place(this.rock, cu.x - rockR, rcy - rockR, rockR * 2, rockR * 2);
    const rs = rockR + 4 * k;
    place(this.rockSocket, cu.x - rs, rcy - rs + 2 * k, rs * 2, rs * 2);
    this.rockShown = null;
    this.cLabel.style.left = px(cu.x);
    this.cLabel.style.top = px(rcy + rockR + 8 * k);
    this.cLabel.style.fontSize = px(8.5 * k);
    this.cLabel.style.display = land ? 'none' : '';
    this.releaseAll(); // touches from the old layout end; repaints
  }

  _placeWell(x, y) {
    const s = this.layout.stick;
    place(this.well, x - s.well, y - s.well, s.well * 2, s.well * 2);
    this.stickShown.x = x;
    this.stickShown.y = y;
  }

  // ---- touches ----------------------------------------------------------------------

  _onTouch(e, phase) {
    if (e.cancelable) e.preventDefault(); // no scrolling, zooming, emulated mouse or click
    const list = e.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      this._pointer(phase, t.identifier, t.clientX, t.clientY, false);
    }
    this._update();
  }

  // One touch (or the mouse) starts, moves or ends at (x, y).
  _pointer(phase, id, x, y, update = true) {
    if (!this.layout || !this.shown) return;
    if (phase === 'start') this._begin(id, x, y);
    else {
      const i = this._find(this.touches, id);
      if (i < 0) return;
      const r = this.touches[i];
      if (phase === 'move') this._move(r, x, y);
      else {
        this.touches.splice(i, 1);
        this.events?.emit('touchRelease', { button: r.role });
      }
    }
    if (update) this._update();
  }

  _begin(id, x, y) {
    const L = this.layout;
    const role = touchRole(L, x, y);
    if (!role) return;
    const i = this._find(this.touches, id);
    if (i >= 0) this.touches.splice(i, 1); // a lost end event
    const r = {
      id,
      role,
      origin: TOUCH_BUTTONS.includes(role) ? role : null, // the button it holds while it lasts
      over: null,
      ox: x, // stick origin
      oy: y,
      floating: false,
      stick: { x: 0, y: 0, mag: 0, kx: 0, ky: 0 },
    };
    r.over = r.origin;
    if (role === 'stick') {
      if (inWell(L, x, y)) {
        r.ox = L.stick.x;
        r.oy = L.stick.y;
      } else {
        r.floating = L.mode === 'landscape'; // the well follows the thumb over the picture
      }
    }
    this.touches.push(r);
    this._move(r, x, y);
    const picture = L.mode === 'landscape' || y < L.top;
    this.events?.emit('touchPress', { button: role, picture });
  }

  _move(r, x, y) {
    const L = this.layout;
    if (r.role === 'stick') stickVector(x - r.ox, y - r.oy, L.stick.travel, r.stick);
    else if (r.role === 'dpad') {
      dpadVector(x - L.dpad.x, y - L.dpad.y, L.dpad.size / 2, r.stick);
    } else r.over = buttonAt(L, x, y);
  }

  // Index of the record with this touch identifier, or -1 (no closure: runs per touchmove).
  _find(list, id) {
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  // Camera drags on the picture.
  _onLook(e, phase) {
    if (!this.shown) return;
    if (e.cancelable) e.preventDefault();
    const list = e.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const j = this._find(this.looks, t.identifier);
      if (phase === 'start') {
        if (j < 0) this.looks.push({ id: t.identifier, x: t.clientX, y: t.clientY });
      } else if (j >= 0) {
        const l = this.looks[j];
        if (phase === 'move') {
          this.input?.addLookDelta?.((t.clientX - l.x) * LOOK_GAIN, (t.clientY - l.y) * LOOK_GAIN);
          l.x = t.clientX;
          l.y = t.clientY;
        } else this.looks.splice(j, 1);
      }
    }
  }

  // Combine the touches into the controller state, hand it to the input, repaint.
  _update() {
    const st = this.state;
    for (let i = 0; i < TOUCH_BUTTONS.length; i++) st[TOUCH_BUTTONS[i]] = false;
    let stick = null;
    let dpad = null;
    for (let i = 0; i < this.touches.length; i++) {
      const r = this.touches[i];
      if (r.origin) st[r.origin] = true;
      if (r.over) st[r.over] = true;
      if (r.role === 'stick' && (!stick || r.stick.mag > stick.stick.mag)) stick = r;
      if (r.role === 'dpad' && (!dpad || r.stick.mag > dpad.stick.mag)) dpad = r;
    }
    const v = stick && stick.stick.mag > 0 ? stick.stick : dpad ? dpad.stick : null;
    st.stickX = v ? v.x : 0;
    st.stickY = v ? v.y : 0;
    this.input?.setTouchState?.(st);
    this._paint(stick, dpad);
  }

  _paint(stick = null, dpad = null) {
    if (!this.root) return;
    const st = this.state;
    let fresh = false;
    for (let i = 0; i < TOUCH_BUTTONS.length; i++) {
      const b = TOUCH_BUTTONS[i];
      if (st[b] === this.lit[b]) continue;
      this.lit[b] = st[b];
      this.buttons[b].classList.toggle('cg-down', st[b]);
      if (st[b]) fresh = true;
    }
    if (fresh) this._buzz();
    this._paintRocker();

    // Stick: the well floats to a landscape thumb; the knob shows the push.
    const L = this.layout;
    if (!L) return;
    const shown = this.stickShown;
    const wx = stick?.floating ? clampTo(stick.ox, L.stick.well, L.width - L.stick.well) : L.stick.x;
    const wy = stick?.floating ? clampTo(stick.oy, L.stick.well, L.height - L.stick.well) : L.stick.y;
    if (wx !== shown.x || wy !== shown.y) this._placeWell(wx, wy);
    const kx = stick ? stick.stick.kx : 0;
    const ky = stick ? stick.stick.ky : 0;
    if (kx !== shown.kx || ky !== shown.ky || !!stick !== shown.drag) {
      shown.kx = kx;
      shown.ky = ky;
      shown.drag = !!stick;
      this.knob.classList.toggle('cg-drag', !!stick);
      this.knob.style.transform = `translate3d(${px(wx + kx)}, ${px(wy + ky)}, 0)`;
    }

    // D-pad: lit arrows and a small rock toward the pressed side.
    const d = dpad?.stick;
    const key = d ? (d.up ? 1 : 0) | (d.down ? 2 : 0) | (d.left ? 4 : 0) | (d.right ? 8 : 0) | 16 : 0;
    if (key !== this.dpadShown) {
      if (key > 16 && !(this.dpadShown > 16)) this._buzz(); // a direction from none
      this.dpadShown = key;
      for (const dir of ['up', 'down', 'left', 'right']) this.dpadArrows[dir].classList.toggle('cg-lit', !!d?.[dir]);
      const rx = d ? (d.up ? 10 : d.down ? -10 : 0) : 0;
      const ry = d ? (d.right ? 10 : d.left ? -10 : 0) : 0;
      this.dpad.style.transform = rx || ry ? `perspective(${px(L.dpad.size * 4)}) rotateX(${rx}deg) rotateY(${ry}deg)` : '';
      this.dpad.classList.toggle('cg-active', !!d);
    }
  }

  // The camera rocker tilts toward its pressed arrows.
  _paintRocker() {
    const st = this.state;
    const key = (st.CU ? 1 : 0) | (st.CD ? 2 : 0) | (st.CL ? 4 : 0) | (st.CR ? 8 : 0);
    if (key === this.rockShown) return;
    this.rockShown = key;
    const rx = (st.CU ? 12 : 0) - (st.CD ? 12 : 0);
    const ry = (st.CR ? 12 : 0) - (st.CL ? 12 : 0);
    const size = this.layout ? this.layout.buttons.CD.y - this.layout.buttons.CU.y : 64;
    this.rock.style.transform = rx || ry ? `perspective(${px(size * 5)}) rotateX(${rx}deg) rotateY(${ry}deg)` : '';
    this.rock.classList.toggle('cg-active', key !== 0);
  }

  // A short buzz on a fresh press, where the browser allows it (Android; needs a prior tap).
  _buzz() {
    try {
      if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      navigator.vibrate(VIBRATE_MS);
    } catch {
      // not allowed: no buzz
    }
  }
}

function clampTo(v, lo, hi) {
  return Math.max(lo, Math.min(Math.max(lo, hi), v));
}
