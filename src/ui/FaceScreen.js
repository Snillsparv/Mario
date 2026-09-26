// Face screen, between the title card and play (a classic N64 start screen's toy, with our own
// hero): Jonas's big 3D head fills the picture, bobbing, blinking and watching the pointer, and
// every bit of it can be grabbed and pulled about. Everything shown and heard is original:
// Jonas's own design (ui/face/pipHead.js, faceArt.js), a hand pointer (face/mitten.js), a sky
// backdrop (face/backdrop.js) and synthesized sounds (audio/sfx.js face_*).
//
//   const face = new FaceScreen(uiRoot, { events, audio, view });
//   await face.show();   // resolves after Start (Enter / Space / Esc, a gamepad's Start or A,
//                        // the touch controller's START or A, a phone's START or A, or a
//                        // click / tap on the hint line), once that key or button is released
//
// Controls: pressing on the head grabs the point under the pointer (a raycast against the shown,
// deformed head) and dragging pulls it after the pointer, the surface round it following with
// a smooth falloff; letting go springs it back with a jelly wobble (up to eight handles wobble
// at once; ui/face/stretch.js). Dragging the sky turns the whole head (it swings back when let
// go); the mouse wheel or a pinch zooms a little; two fingers can pull two points. A quick tap
// on the head pokes it (a boop on the nose). A gamepad's stick or the arrow keys turn it too.
// Reactions: surprise while pulled, alarm when pulled far, a wince at the limit, a giggle while
// it wobbles, a dazed double blink after a big wobble; a rubbery creak while a pull grows, a
// boing on release pitched by how far it was pulled.
//
// Drawing: the head, its lights and the backdrop are a scene of their own, drawn by the game's
// renderer instead of the world (view.setView(scene, camera)), so the retro filter applies.
// Three draw calls (backdrop, skull, the rest of the head), ~50k triangles.
//
// Input stays in here: pointer / wheel listeners on the screen's own overlay, keys caught in
// the capture phase (the game's Input never sees the Start key), the touch controller's and the
// phone's press events, gamepads polled every frame (buttons already held when the screen
// appeared are ignored until released). All of it, and every geometry, material and texture, is
// released when the screen goes. Test hooks: ready, stretch, turn, zoom, head, state(),
// project(x, y, z), projectShare(x, y, z), displacementAt(x, y, z), pointer(type, fx, fy,
// opts), timeScale and advance(seconds).

import * as THREE from 'three';
import { SMALL_FONT } from './bitmapFont.js';
import { SpriteCache, textCanvas } from './raster.js';
import { hudMetrics } from './hudLogic.js';
import { pixelRatio } from './pixelRatio.js';
import { touchUi } from './touchLogic.js';
import { PipHead } from './face/pipHead.js';
import { Backdrop } from './face/backdrop.js';
import { MITTEN_OPEN, MITTEN_FIST, HOTSPOTS } from './face/mitten.js';
import { Stretch, HeadTurn, Zoom, FaceMood, FACE_EXPRESSIONS, STRETCH, clamp } from './face/stretch.js';
import { hintKind, hintLines } from './face/faceText.js';
import { SUN_COLOR, SUN_INTENSITY, AMBIENT_SKY_COLOR, AMBIENT_GROUND_COLOR, AMBIENT_INTENSITY } from '../render/N64Renderer.js';

const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'Escape']);
const TURN_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const PAD_START_BUTTONS = [9, 0, 1, 2]; // Start, and the jump / attack face buttons of any pad layout (core/input.js padLayout)
const TOUCH_START_BUTTONS = new Set(['START', 'A']);
const REMOTE_START_BUTTONS = new Set(['START', 'A']);
const FADE_MS = 400;
const RELEASE_TIMEOUT_MS = 2000; // never wait forever for a key-up that got lost (blur)
// Leaving, Jonas spins away while the picture washes to a warm white, which then fades off the
// game's first frames.
const CURTAIN_OUT_MS = 450;

// Framing: the picture shows at least VIEW_HEIGHT head units top to bottom and VIEW_WIDTH
// across (the cap, hair tufts and ears are the widest part), the head a little above the middle.
const FOV = 30;
const VIEW_HEIGHT = 96;
const VIEW_WIDTH = 118;
const LOOK_Y = -8;
// At rest the head is tipped forward a touch, so the cap's bill shows over the glasses.
const REST_PITCH = 0.07;
// A pull also brings the grabbed point toward the viewer by this share of the drag (up to
// BULGE_MAX units), so a pulled nose or cheek comes out of the face instead of sliding across.
const BULGE = 0.35;
const BULGE_MAX = 26;
const CREAK_STEP = 7; // head units of extra pull per creak
const TAP_MS = 260; // a press this short that did not move is a poke
const TAP_PX = 6;
const NOSE = new THREE.Vector3(0, -5.5, 34.8); // the tip of the nose (head space)
const POKE_SPEED = 160; // units/s into the head: a poke's jiggle

const CSS = `
.cg-face { position:absolute; inset:0; overflow:hidden; user-select:none; -webkit-user-select:none;
  touch-action:none; -webkit-tap-highlight-color:transparent; pointer-events:auto; cursor:none;
  transition: opacity ${FADE_MS}ms ease-in; }
.cg-face.cg-out { opacity:0; }
.cg-face canvas { display:block; image-rendering:pixelated; }
.cg-face-lines { position:absolute; left:50%; transform:translateX(-50%); display:flex; flex-direction:column;
  align-items:center; pointer-events:none; }
.cg-face-sub { opacity:0.8; }
.cg-face-hint { pointer-events:auto; cursor:pointer; border-radius:calc(var(--u) * 3);
  background:rgba(8,10,40,0.42); border:max(1px, calc(var(--u) * 0.5)) solid rgba(255,230,150,0.35);
  transition: background 0.12s, border-color 0.12s; }
.cg-face-hint:hover { background:rgba(24,28,80,0.7); border-color:rgba(255,230,150,0.9); }
.cg-face-cursor { position:absolute; left:0; top:0; pointer-events:none; will-change:transform; display:none; }
.cg-face-cursor.cg-on { display:block; }
.cg-face-cursor canvas { position:absolute; left:0; top:0; }
.cg-face-curtain { position:absolute; inset:0; pointer-events:none; background:#fffaf0; opacity:0;
  transition: opacity ${FADE_MS}ms ease-in; }
.cg-face-curtain.cg-on { opacity:0.92; }
.cg-face-curtain.cg-off { opacity:0; transition: opacity ${CURTAIN_OUT_MS}ms ease-out; }
`;

function injectStyles() {
  if (document.getElementById('cg-face-css')) return;
  const style = document.createElement('style');
  style.id = 'cg-face-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

// The page's sticky user activation (see TitleScreen): true/false, or null if unknown.
function hasBeenActive() {
  const ua = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;
  return ua ? !!ua.hasBeenActive : null;
}

function connectedPads() {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  return [...pads].filter((p) => p && p.connected);
}

const smoothstep = (x) => x * x * (3 - 2 * x);

export class FaceScreen {
  constructor(root, { events = null, audio = null, view = null } = {}) {
    this.root = root;
    this.events = events;
    this.audio = audio;
    this.view = view;
    this.el = null;
    this.ready = false; // the first frame is drawn
    this.shown = false;
    this.timeScale = 1; // (test / screenshot hook: 0 freezes the animation, see advance())
    this.stretch = new Stretch();
    this.turn = new HeadTurn();
    this.zoom = new Zoom();
    this.mood = new FaceMood();
    this.head = null;
  }

  show() {
    if (this.shown) return this._done;
    this.shown = true;
    this._done = new Promise((resolve) => this._open(resolve));
    return this._done;
  }

  // ---- setup / teardown -------------------------------------------------------------

  _open(resolve) {
    injectStyles();
    this.resolve = resolve;
    this.cleanups = [];
    this.pointers = new Map(); // pointerId -> { kind: 'grab' | 'turn', ... }
    this.leaving = false;
    this.time = 0;
    this.outro = -1; // seconds since Start, -1 before
    this.pop = { s: 0.12, v: 0 }; // the head pops in (a spring on its scale)
    this.look = { x: 0, y: 0, tx: 0, ty: 0, idle: 0, wander: 1.5 };
    this.lastPointer = null; // { x, y, type, at } in overlay CSS px
    this.overHint = false;
    this.keysTurn = new Set();
    this.pinch = null; // two fingers on the sky: { a, b, d0 }
    this.padStick = null;
    this.padRelease = null;
    this.popped = false;
    this.stretch.reset();
    this.turn = new HeadTurn();
    this.zoom = new Zoom();
    this.mood = new FaceMood();
    this._buildScene();
    this._buildDom();
    this.audio?.playMusic?.('title'); // keeps playing from the title card (no-op if it is on)
    this._listen();
    this.view?.setView(this.scene, this.camera);
    // Upload every expression now, not on its first use (a hitch as the first pull starts).
    for (const t of this.head.art.textures.values()) this.view?.renderer?.initTexture?.(t);
    this.last = performance.now();
    this.heldPad = this._pressedPadButtons(); // held since before: not a fresh Start
    const frame = (now) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this._frame(dt);
    };
    this.raf = requestAnimationFrame(frame);
    this._frame(0); // pose and draw at once: no frame of the world in between
  }

  _buildScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa9caee);
    this.camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 10, 3000);
    const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY * 1.1);
    sun.position.set(-0.5, 0.8, 1); // upper left, in front
    const fill = new THREE.HemisphereLight(AMBIENT_SKY_COLOR, AMBIENT_GROUND_COLOR, AMBIENT_INTENSITY);
    this.backdrop = new Backdrop();
    this.head = new PipHead();
    this.scene.add(sun, fill, this.backdrop.mesh, this.head.object3D);
    this.headInverse = new THREE.Matrix4();
    this.raycaster = new THREE.Raycaster();
    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.ndc = new THREE.Vector2();
  }

  _buildDom() {
    const el = (this.el = document.createElement('div'));
    el.className = 'cg-face';
    this.root.appendChild(el);
    this.lines = document.createElement('div');
    this.lines.className = 'cg-face-lines';
    this.subCanvas = document.createElement('canvas');
    this.subCanvas.className = 'cg-face-sub';
    this.hint = document.createElement('div');
    this.hint.className = 'cg-face-hint';
    this.hint.setAttribute('role', 'button');
    this.hintCanvas = document.createElement('canvas');
    this.hint.append(this.hintCanvas);
    this.lines.append(this.subCanvas, this.hint);
    this.cursor = document.createElement('div');
    this.cursor.className = 'cg-face-cursor';
    this.cursorOpen = document.createElement('canvas');
    this.cursorFist = document.createElement('canvas');
    this.cursor.append(this.cursorOpen, this.cursorFist);
    el.append(this.lines, this.cursor);
    this.curtain = document.createElement('div');
    this.curtain.className = 'cg-face-curtain';
    this.curtain.style.pointerEvents = 'none'; // (the game's #ui > * rule would make it catch them)
    this.root.appendChild(this.curtain);
    this.kind = null;
    this.layoutKey = '';
    this._layout();
  }

  // Size the texts and the pointer for the overlay box (320x240 logical units, like the HUD).
  _layout() {
    const el = this.el;
    if (!el) return;
    const dpr = pixelRatio();
    const kind = hintKind({ touch: touchUi.active, pad: connectedPads().length > 0 });
    const { scale: u } = hudMetrics(el.clientWidth || innerWidth, el.clientHeight || innerHeight);
    const key = `${u}|${dpr}|${kind}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.kind = kind;
    this.dpr = dpr;
    el.style.setProperty('--u', `${u}px`);
    const px = u * dpr;
    const [hint, sub] = hintLines(kind);
    const fit = (canvas, text, alpha = 1) => {
      const c = textCanvas(SMALL_FONT, text, px, 'white');
      canvas.width = c.width;
      canvas.height = c.height;
      canvas.getContext('2d').drawImage(c, 0, 0);
      canvas.style.width = `${c.width / dpr}px`;
      canvas.style.height = `${c.height / dpr}px`;
      canvas.style.opacity = String(alpha);
    };
    fit(this.hintCanvas, hint);
    fit(this.subCanvas, sub);
    this.hint.setAttribute('aria-label', hint);
    this.hint.style.padding = `${Math.round(u)}px ${Math.round(u * 3)}px`;
    this.subCanvas.style.marginBottom = `${Math.round(u)}px`;
    this.lines.style.bottom = `${Math.round(u * 5)}px`;
    // The mitten at a whole number of device px per icon pixel (crisp), about the HUD's size.
    const cpx = Math.max(2, Math.round(u * dpr * 1.45));
    this.cursorPx = cpx;
    const cache = new SpriteCache();
    for (const [canvas, icon, name] of [[this.cursorOpen, MITTEN_OPEN, 'mittenOpen'], [this.cursorFist, MITTEN_FIST, 'mittenFist']]) {
      const s = cache.icon(icon, name, cpx);
      canvas.width = s.back.width;
      canvas.height = s.back.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(s.back, 0, 0);
      ctx.drawImage(s.front, 0, 0);
      canvas.style.width = `${s.back.width / dpr}px`;
      canvas.style.height = `${s.back.height / dpr}px`;
      canvas.dataset.ox = String(s.ox / dpr);
      canvas.dataset.oy = String(s.oy / dpr);
    }
  }

  _listen() {
    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn, opts));
    };
    const el = this.el;
    listen(el, 'pointerdown', (e) => this._down(e));
    listen(el, 'pointermove', (e) => this._move(e));
    listen(el, 'pointerup', (e) => this._up(e));
    listen(el, 'pointercancel', (e) => this._up(e));
    listen(el, 'lostpointercapture', (e) => this._up(e));
    listen(el, 'pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.pointers.has(e.pointerId)) this._hover(null);
    });
    listen(el, 'wheel', (e) => {
      e.preventDefault();
      this.zoom.wheel(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1));
    }, { passive: false });
    listen(el, 'contextmenu', (e) => e.preventDefault());
    // The hint line is a button: no grab, a click starts.
    listen(this.hint, 'pointerdown', (e) => {
      e.stopPropagation();
      this._unlockAudio();
      this._hover(null);
    });
    listen(this.hint, 'click', (e) => {
      e.stopPropagation();
      this._begin(Promise.resolve());
    });
    listen(window, 'blur', () => this._releaseAll());

    // Keys, in the capture phase: the Start key never reaches the game's Input.
    let keyReleased = null;
    listen(window, 'keydown', (e) => {
      if (START_KEYS.has(e.code)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat && !this.leaving) {
          this._unlockAudio();
          this._begin(new Promise((r) => (keyReleased = { code: e.code, r })));
        }
        return;
      }
      if (e.code in TURN_KEYS) {
        e.preventDefault();
        this.keysTurn.add(e.code);
      }
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoom.wheel(-120);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoom.wheel(120);
    }, true);
    listen(window, 'keyup', (e) => {
      this.keysTurn.delete(e.code);
      if (keyReleased && e.code === keyReleased.code) keyReleased.r();
    });

    const on = (name, fn) => this.events && this.cleanups.push(this.events.on(name, fn));
    // The touch controller's START / A starts (once that touch ends).
    let touchHeld = null;
    on('touchPress', (e) => {
      if (!e || !TOUCH_START_BUTTONS.has(e.button) || this.leaving) return;
      this._begin(new Promise((r) => (touchHeld = { button: e.button, r })));
    });
    on('touchRelease', (e) => {
      if (touchHeld && e?.button === touchHeld.button) touchHeld.r();
    });
    on('touchUi', () => this._layout());
    // A phone used as the controller: START / A.
    let remoteHeld = null;
    on('remotePress', (e) => {
      if (!e || !REMOTE_START_BUTTONS.has(e.button) || this.leaving) return;
      this._begin(new Promise((r) => (remoteHeld = { button: e.button, r })));
    });
    on('remoteRelease', (e) => {
      if (remoteHeld && e?.button === remoteHeld.button) remoteHeld.r();
    });
    const observer = new ResizeObserver(() => this._layout());
    observer.observe(this.el);
    this.cleanups.push(() => observer.disconnect());
  }

  // Start pressed: fade out, then resolve once the press is released too.
  _begin(released) {
    if (this.leaving || !this.el) return;
    this.leaving = true;
    if (hasBeenActive() !== false) this._unlockAudio();
    this.events?.emit('sfx', { name: 'menu_select' });
    this._releaseAll();
    this.outro = 0;
    this.el.classList.add('cg-out');
    this.curtain.classList.add('cg-on');
    const faded = new Promise((r) => setTimeout(r, FADE_MS));
    const timeout = new Promise((r) => setTimeout(r, FADE_MS + RELEASE_TIMEOUT_MS));
    Promise.all([faded, Promise.race([released, timeout])]).then(() => this._close());
  }

  _close() {
    cancelAnimationFrame(this.raf);
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    this.pointers.clear();
    if (this.view?.viewScene === this.scene) this.view.setView();
    this.head.dispose();
    this.backdrop.dispose();
    this.scene.clear();
    this.head = null;
    this.el.remove();
    this.el = null;
    // The curtain fades off whatever is drawn next (the game), then goes.
    const curtain = this.curtain;
    this.curtain = null;
    requestAnimationFrame(() => curtain.classList.add('cg-off'));
    setTimeout(() => curtain.remove(), CURTAIN_OUT_MS + 100);
    this.ready = false;
    this.shown = false;
    this.resolve();
  }

  _unlockAudio() {
    const a = this.audio;
    if (!a?.unlock || a.muted || a.ctx?.state === 'running') return;
    a.unlock();
    a.playMusic?.('title');
  }

  // ---- pointers -----------------------------------------------------------------------

  _local(e) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width || 1, h: r.height || 1 };
  }

  _hover(p, type = 'mouse') {
    this.lastPointer = p ? { ...p, type, at: this.time } : null;
  }

  _down(e) {
    if (this.leaving || !this.head) return;
    this._unlockAudio();
    const p = this._local(e);
    this._hover(p, e.pointerType);
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const stale = this.pointers.get(e.pointerId); // its up event got lost: let that one go
    if (stale) {
      this.pointers.delete(e.pointerId);
      this._end(stale);
    }
    try {
      this.el.setPointerCapture?.(e.pointerId);
    } catch {
      // synthetic pointers (test hooks) cannot be captured
    }
    const rec = { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, at: performance.now(), moved: false, type: e.pointerType };
    const hit = e.button === 2 ? null : this._pick(p);
    const handle = hit ? this.stretch.grab(hit.point.x, hit.point.y, hit.point.z) : null;
    if (handle) {
      Object.assign(rec, { kind: 'grab', handle, rest: hit.point, from: hit.hit.clone(), plane: hit.world.z, fromWorld: hit.world.clone(), creak: 0 });
      this._sfx('face_grab', { pan: this._pan(p) });
    } else {
      rec.kind = 'turn';
      const turning = [...this.pointers.values()].filter((r) => r.kind === 'turn');
      if (turning.length === 0) this.turn.grab();
      else if (turning.length === 1) {
        // A second finger on the sky: pinch to zoom (the turn stays where it is).
        this.zoom.pinchStart();
        this.pinch = { a: turning[0], b: rec, d0: Math.hypot(turning[0].x - rec.x, turning[0].y - rec.y) || 1 };
      }
    }
    this.pointers.set(e.pointerId, rec);
  }

  _move(e) {
    if (!this.el) return;
    const p = this._local(e);
    this._hover(p, e.pointerType);
    this.overHint = !!e.target && this.hint.contains(e.target);
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    const dx = p.x - rec.x;
    const dy = p.y - rec.y;
    rec.x = p.x;
    rec.y = p.y;
    if (Math.hypot(p.x - rec.sx, p.y - rec.sy) > TAP_PX) rec.moved = true;
    if (rec.kind !== 'turn') return;
    if (this.pinch && (this.pinch.a === rec || this.pinch.b === rec)) {
      const { a, b, d0 } = this.pinch;
      this.zoom.pinch(Math.hypot(a.x - b.x, a.y - b.y) / d0);
    } else {
      this.turn.drag(dx / p.h, dy / p.h);
    }
  }

  _up(e) {
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    this.pointers.delete(e.pointerId);
    if (e.pointerType !== 'mouse' && this.lastPointer?.type !== 'mouse') this._hover(null);
    this._end(rec);
  }

  _end(rec) {
    if (rec.kind === 'grab') {
      const h = rec.handle;
      const quick = !rec.moved && performance.now() - rec.at < TAP_MS;
      const peak = this.stretch.release(h);
      const pan = this._pan(rec);
      if (quick) {
        // A poke: the spot is pushed in and jiggles back.
        const n = this.v1.set(rec.rest.x, rec.rest.y, rec.rest.z).normalize();
        h.vx -= n.x * POKE_SPEED;
        h.vy -= n.y * POKE_SPEED;
        h.vz -= n.z * POKE_SPEED;
        const nose = this.v2.set(rec.rest.x, rec.rest.y, rec.rest.z).distanceTo(NOSE) < 7;
        this._sfx(nose ? 'face_boop' : 'face_boing', { pan, pitch: nose ? 1 : 1.5, volume: nose ? 1 : 0.4 });
      } else if (peak > 5) {
        const k = clamp(peak / STRETCH.MAX, 0, 1);
        this._sfx('face_boing', { pan, pitch: 1.35 - 0.6 * k, volume: 0.45 + 0.55 * k });
      }
    } else if (rec.kind === 'turn') {
      if (this.pinch && (this.pinch.a === rec || this.pinch.b === rec)) {
        this.pinch = null;
        this.turn.grab(); // the finger left on the sky turns again from here
      }
      if (![...this.pointers.values()].some((r) => r.kind === 'turn')) this.turn.release();
    }
  }

  _releaseAll() {
    for (const rec of this.pointers.values()) this._end(rec);
    this.pointers.clear();
    this.pinch = null;
    this.stretch.releaseAll();
    this.turn.release();
    this.keysTurn?.clear();
  }

  _pan(p) {
    const w = this.el?.clientWidth || 1;
    return clamp((p.x / w - 0.5) * 1.2, -0.6, 0.6);
  }

  _sfx(name, opts = {}) {
    this.events?.emit('sfx', { name, ...opts });
  }

  // World ray through overlay point p (CSS px).
  _ray(p) {
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    this.ndc.set((p.x / w) * 2 - 1, -((p.y / h) * 2 - 1));
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray;
  }

  // The shown head under overlay point p: { point (rest space), hit (head space), world }.
  _pick(p) {
    const ray = this._ray(p);
    const o = ray.origin.clone().applyMatrix4(this.headInverse);
    const d = ray.origin.clone().add(ray.direction).applyMatrix4(this.headInverse).sub(o);
    const hit = this.head.pick(o, d, this.stretch);
    if (!hit) return null;
    const local = new THREE.Vector3(hit.hit.x, hit.hit.y, hit.hit.z);
    return { point: hit.point, hit: local, world: local.clone().applyMatrix4(this.head.object3D.matrixWorld) };
  }

  // ---- the frame ----------------------------------------------------------------------

  _frame(dt) {
    if (!this.el) return;
    dt *= this.timeScale;
    this.time += dt;
    this._pollPads();
    if (pixelRatio() !== this.dpr) this._layout();
    this._poseCamera(dt);
    this._poseHead(dt);
    this._pullHandles();
    this.stretch.update(dt);
    this.head.sync(this.stretch);
    const expr = this.mood.update(dt, { holding: this.stretch.holding, pull: this.stretch.pullLevel(), wobble: this.stretch.wobbleLevel() });
    this.head.setExpression(expr, FACE_EXPRESSIONS[expr].iris);
    this._eyes(dt);
    this.backdrop.update(this.time, this.camera.aspect);
    this._drawCursor();
    if (this.view?.viewScene === this.scene) this.view.render();
    this.ready = true;
  }

  _poseCamera(dt) {
    const cam = this.camera;
    this.zoom.update(dt);
    const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const height = Math.max(VIEW_HEIGHT, VIEW_WIDTH / (cam.aspect || 1));
    const dist = height / 2 / halfTan / this.zoom.value;
    cam.position.set(0, LOOK_Y, dist);
    cam.lookAt(0, LOOK_Y, 0);
    cam.updateMatrixWorld();
  }

  _poseHead(dt) {
    const t = this.time;
    // The pop-in: an underdamped spring on the scale.
    const w = Math.PI * 2 * 2.1;
    for (let i = 0, n = Math.ceil(dt / (1 / 240)); i < n; i++) {
      const sdt = dt / n;
      this.pop.v += (w * w * (1 - this.pop.s) - 2 * 0.32 * w * this.pop.v) * sdt;
      this.pop.s += this.pop.v * sdt;
    }
    if (this.time > 0.05 && !this.popped) {
      this.popped = true;
      this._sfx('face_boing', { pitch: 1.3, volume: 0.35 });
    }
    // Turning: a drag on the sky, a pad's stick or the arrow keys.
    let kx = 0;
    let ky = 0;
    for (const code of this.keysTurn) {
      kx += TURN_KEYS[code][0];
      ky += TURN_KEYS[code][1];
    }
    const stick = this.padStick ?? { x: 0, y: 0 };
    this.turn.setStick(clamp(kx + stick.x, -1, 1), clamp(ky + stick.y, -1, 1));
    this.turn.update(dt);
    let scale = this.pop.s;
    let spin = 0;
    if (this.outro >= 0) {
      this.outro += dt;
      const k = smoothstep(clamp(this.outro / (FADE_MS / 1000), 0, 1));
      scale *= 1 - 0.9 * k;
      spin = k * Math.PI * 1.5;
    }
    const o = this.head.object3D;
    o.position.set(0, Math.sin(t * 1.8) * 1.1, 0);
    o.rotation.order = 'YXZ';
    o.rotation.set(
      REST_PITCH + this.turn.pitch + Math.sin(t * 1.25) * 0.025,
      this.turn.yaw + Math.sin(t * 0.55) * 0.07 + spin,
      Math.sin(t * 0.9) * 0.04,
    );
    o.scale.setScalar(Math.max(0.02, scale));
    o.updateMatrixWorld(true);
    this.headInverse.copy(o.matrixWorld).invert();
  }

  // Held handles follow their pointers: the point under the pointer on the grab's depth plane
  // (plus the bulge toward the viewer), in head space, minus where the grab started.
  _pullHandles() {
    for (const rec of this.pointers.values()) {
      if (rec.kind !== 'grab' || !rec.handle.held) continue;
      const ray = this._ray(rec);
      const t = (rec.plane - ray.origin.z) / (ray.direction.z || -1e-6);
      const world = this.v1.copy(ray.direction).multiplyScalar(t).add(ray.origin);
      const scale = this.head.object3D.scale.x || 1;
      const dragged = Math.hypot(world.x - rec.fromWorld.x, world.y - rec.fromWorld.y) / scale;
      world.z += Math.min(BULGE_MAX, dragged * BULGE) * scale;
      const local = world.applyMatrix4(this.headInverse);
      const len = this.stretch.pull(rec.handle, local.x - rec.from.x, local.y - rec.from.y, local.z - rec.from.z);
      // A rubbery creak each time the pull grows by another step.
      if (len > rec.creak + CREAK_STEP) {
        rec.creak = len;
        const k = len / STRETCH.MAX;
        this._sfx('face_stretch', { pan: this._pan(rec), pitch: 0.75 + 0.9 * k, volume: 0.5 + 0.5 * k });
      } else if (len < rec.creak - CREAK_STEP * 2) {
        rec.creak = len;
      }
    }
  }

  // The irises follow the pointer (the one pulling, else the last seen); with none about they
  // drift back to the viewer and wander now and then.
  _eyes(dt) {
    const L = this.look;
    const p = this.lastPointer;
    const el = this.el;
    if (p && el) {
      const c = this.v2.set(0, 2, 20).applyMatrix4(this.head.object3D.matrixWorld).project(this.camera);
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      const sx = ((p.x / w) * 2 - 1 - c.x) * (w / h);
      const sy = -((p.y / h) * 2 - 1) - c.y;
      const len = Math.hypot(sx, sy);
      const k = len > 0.5 ? 1 / len : 2; // within half a picture height it eases toward the middle
      L.tx = sx * k;
      L.ty = -sy * k;
      L.idle = 0;
    } else {
      L.idle += dt;
      L.wander -= dt;
      if (L.idle < 1.2) {
        L.tx *= 0.9;
        L.ty *= 0.9;
      } else if (L.wander <= 0) {
        L.wander = 1.2 + Math.random() * 2.4;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() < 0.4 ? 0 : 0.35 + Math.random() * 0.45;
        L.tx = Math.cos(a) * r;
        L.ty = Math.sin(a) * r * 0.6;
      }
    }
    const e = 1 - Math.exp(-16 * dt);
    L.x += (clamp(L.tx, -1, 1) - L.x) * e;
    L.y += (clamp(L.ty, -1, 1) - L.y) * e;
    this.head.setLook(L.x, L.y);
  }

  _drawCursor() {
    const p = this.lastPointer;
    const on = !!p && p.type === 'mouse' && !this.leaving && !this.overHint;
    this.cursor.classList.toggle('cg-on', on);
    if (!on) return;
    const holding = [...this.pointers.values()].some((r) => r.type === 'mouse');
    const [hx, hy] = holding ? HOTSPOTS.fist : HOTSPOTS.open;
    const show = holding ? this.cursorFist : this.cursorOpen;
    const hide = holding ? this.cursorOpen : this.cursorFist;
    show.style.display = 'block';
    hide.style.display = 'none';
    const s = this.cursorPx / this.dpr;
    const x = p.x - hx * s + Number(show.dataset.ox);
    const y = p.y - hy * s + Number(show.dataset.oy);
    this.cursor.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  // Gamepads: a fresh Start / A begins (on release); the left stick turns the head.
  _pollPads() {
    const down = this._pressedPadButtons();
    for (const k of this.heldPad) if (!down.has(k)) this.heldPad.delete(k);
    const pads = connectedPads();
    const pad = pads.find((p) => p.mapping === 'standard') ?? pads[0];
    const ax = pad?.axes?.[0] ?? 0;
    const ay = pad?.axes?.[1] ?? 0;
    this.padStick = Math.hypot(ax, ay) > 0.2 ? { x: ax, y: -ay } : null;
    if (!this.leaving) {
      const fresh = [...down].find((k) => !this.heldPad.has(k));
      if (fresh) this._begin(new Promise((r) => (this.padRelease = { key: fresh, r })));
    } else if (this.padRelease && !down.has(this.padRelease.key)) {
      this.padRelease.r();
    }
    if ((pads.length > 0) !== (this.kind === 'pad') && this.kind !== 'touch') this._layout();
  }

  _pressedPadButtons() {
    const out = new Set();
    for (const p of connectedPads()) for (const b of PAD_START_BUTTONS) if (p.buttons[b]?.pressed) out.add(`${p.index}:${b}`);
    return out;
  }

  // ---- test / preview hooks ----------------------------------------------------------

  // Overlay CSS px of head-space point (x, y, z) as shown now.
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(this.head.object3D.matrixWorld).project(this.camera);
    const r = this.el.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  // The same as shares of the overlay's width and height (for pointer()).
  projectShare(x, y, z) {
    const p = this.project(x, y, z);
    const r = this.el.getBoundingClientRect();
    return { x: (p.x - r.left) / r.width, y: (p.y - r.top) / r.height };
  }

  // How far rest-space point (x, y, z) is moved by the handles now (head units).
  displacementAt(x, y, z) {
    const d = this.stretch.displacement(x, y, z);
    return Math.hypot(d.x, d.y, d.z);
  }

  state() {
    return {
      ready: this.ready,
      leaving: this.leaving,
      expression: this.head?.expression ?? null,
      handles: this.stretch.handles.filter((h) => h.active).map((h) => ({
        id: h.id,
        held: h.held,
        grab: [h.gx, h.gy, h.gz],
        offset: Math.hypot(h.ox, h.oy, h.oz),
      })),
      pull: this.stretch.pullLevel(),
      wobble: this.stretch.wobbleLevel(),
      yaw: this.turn.yaw,
      pitch: this.turn.pitch,
      zoom: this.zoom.value,
      look: [this.look.x, this.look.y],
      triangles: this.head?.triangles ?? 0,
    };
  }

  // Run the animation `seconds` on (in 60 Hz frames) whatever timeScale says: with timeScale
  // 0, scripted screenshots can stop it at an exact moment (a wobble mid-swing).
  advance(seconds) {
    const scale = this.timeScale;
    this.timeScale = 1;
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) this._frame(1 / 60);
    this.timeScale = scale;
  }

  // A scripted pointer (previews, screenshots): type 'down' | 'move' | 'up' at (fx, fy), shares
  // of the overlay's width and height. opts: { id, pointerType, button }.
  pointer(type, fx, fy, { id = 1, pointerType = 'mouse', button = 0 } = {}) {
    if (!this.el) return;
    const r = this.el.getBoundingClientRect();
    const e = {
      pointerId: id,
      pointerType,
      button,
      clientX: r.left + fx * r.width,
      clientY: r.top + fy * r.height,
      preventDefault() {},
    };
    if (type === 'down') this._down(e);
    else if (type === 'move') this._move(e);
    else this._up(e);
  }
}
