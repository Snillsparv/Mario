// Virtual N64-style controller built from keyboard, mouse and gamepad input.
//
// poll() is called once per 30 Hz simulation tick and returns a snapshot:
//   {
//     stickX, stickY,   // -1..1, stick up = +1 (after deadzone, clamped to the unit circle)
//     stickMag,         // 0..1
//     A, B, Z, R, START, CU, CD, CL, CR: { down, pressed, released }
//     mouseDX, mouseDY  // accumulated mouse drag since the last poll (pixels), for camera orbit
//   }
//
// Keyboard: WASD move, Q = walk slowly, Space/K = A (jump), J = B (punch/dive),
// Shift/L = Z (crouch/ground pound), arrow keys = C buttons (camera), C = R (camera mode),
// Enter/Esc = Start, mouse drag = camera orbit. Gamepad (standard mapping): left stick, A = A, X/B = B, triggers = Z,
// right stick = C buttons, RB = R, Start = Start.
//
// Gamepads: every connected pad with the standard mapping is read and merged (buttons OR'ed,
// the stick pushed furthest wins), so an idle or odd device ahead of the real controller in
// navigator.getGamepads() (a virtual pad, a receiver that registers as a gamepad) cannot hide
// it; the title accepts Start/A from any pad too. Pads without the standard mapping have
// arbitrary button/axis layouts: they are read only when no standard pad is connected, and
// then only the most recently active one (latest timestamp).
//
// Tests can inject input with setOverride({ stickX, stickY, A: true, ... }); overridden
// buttons are treated as held and edge detection still works across polls.
//
// Short taps are latched: a key (or gamepad button, sampled every render frame via
// sample()) that goes down and up again between two polls still reads as held for one
// poll, so it is `pressed` on that poll and `released` on the next.

const BUTTONS = ['A', 'B', 'Z', 'R', 'START', 'CU', 'CD', 'CL', 'CR'];

const KEYMAP = {
  Space: 'A',
  KeyK: 'A',
  KeyJ: 'B',
  ShiftLeft: 'Z',
  ShiftRight: 'Z',
  KeyL: 'Z',
  KeyC: 'R',
  Enter: 'START',
  Escape: 'START',
  ArrowUp: 'CU',
  ArrowDown: 'CD',
  ArrowLeft: 'CL',
  ArrowRight: 'CR',
};

const KEY_ENTRIES = Object.entries(KEYMAP);

const DEADZONE = 0.18;

function browserGamepads() {
  return typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
}

function buttonRecord() {
  const r = {};
  for (const b of BUTTONS) r[b] = false;
  return r;
}

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.tapped = new Set(); // key codes that went down since the last poll
    this.padLatch = buttonRecord(); // gamepad buttons seen down by sample() since the last poll
    this.held = buttonRecord(); // scratch for poll()
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.dragging = false;
    this.override = null;
    this.prev = buttonRecord();
    this.enabled = true;
    this.getGamepads = browserGamepads; // replaceable (tests)
    this._pads = []; // scratch: the pads read this poll/sample

    this._onKeyDown = (e) => {
      if (e.code in KEYMAP || /^Key[WASDQ]$/.test(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.tapped.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => {
      this.keys.clear();
      this.tapped.clear();
      // A button released outside the unfocused window never sends mouseup here.
      this.dragging = false;
    };
    this._onMouseDown = (e) => {
      if (e.button === 0 || e.button === 2) this.dragging = true;
    };
    this._onMouseUp = () => {
      this.dragging = false;
    };
    this._onMouseMove = (e) => {
      if (!this.dragging) return;
      // Neither drag button held any more (released while another window had focus).
      if (typeof e.buttons === 'number' && (e.buttons & 3) === 0) {
        this.dragging = false;
        return;
      }
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onContext = (e) => e.preventDefault();

    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('blur', this._onBlur);
    target.addEventListener('mousedown', this._onMouseDown);
    target.addEventListener('mouseup', this._onMouseUp);
    target.addEventListener('mousemove', this._onMouseMove);
    target.addEventListener('contextmenu', this._onContext);
    this.target = target;
  }

  setOverride(state) {
    this.override = state;
  }

  // The pads to read (see the header): all connected standard-mapping pads, else the most
  // recently active connected pad. Returns a reused array.
  _gamepads() {
    const out = this._pads;
    out.length = 0;
    const pads = this.getGamepads() || [];
    let other = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || !p.connected) continue;
      if (p.mapping === 'standard') out.push(p);
      else if (!other || (p.timestamp || 0) > (other.timestamp || 0)) other = p;
    }
    if (out.length === 0 && other) out.push(other);
    return out;
  }

  // Sets out[btn] = true for every mapped gamepad button currently held.
  _padButtons(pad, out) {
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    if (b(0)) out.A = true;
    if (b(1) || b(2)) out.B = true;
    if (b(6) || b(7) || b(4)) out.Z = true;
    if (b(5)) out.R = true;
    if (b(9)) out.START = true;
    const rx = pad.axes[2] || 0;
    const ry = pad.axes[3] || 0;
    if (rx < -0.5 || b(14)) out.CL = true;
    if (rx > 0.5 || b(15)) out.CR = true;
    if (ry < -0.5 || b(12)) out.CU = true;
    if (ry > 0.5 || b(13)) out.CD = true;
  }

  // Call once per render frame: latches gamepad buttons that are held now, so a flick
  // shorter than a 30 Hz tick still reaches the next poll().
  sample() {
    if (!this.enabled) return;
    const pads = this._gamepads();
    for (let i = 0; i < pads.length; i++) this._padButtons(pads[i], this.padLatch);
  }

  // Forget latched taps and the previous button state (held buttons will not read as
  // freshly pressed). Used when gameplay (re)starts after a menu.
  flush() {
    this.tapped.clear();
    for (const b of BUTTONS) this.padLatch[b] = false;
    this.poll();
  }

  poll() {
    let sx = 0;
    let sy = 0;
    const held = this.held;
    for (let i = 0; i < BUTTONS.length; i++) {
      const b = BUTTONS[i];
      held[b] = this.padLatch[b];
      this.padLatch[b] = false;
    }

    if (this.enabled) {
      const k = this.keys;
      if (k.has('KeyW')) sy += 1;
      if (k.has('KeyS')) sy -= 1;
      if (k.has('KeyD')) sx += 1;
      if (k.has('KeyA')) sx -= 1;
      const len = Math.hypot(sx, sy);
      if (len > 0) {
        const walk = k.has('KeyQ') ? 0.45 : 1;
        sx = (sx / len) * walk;
        sy = (sy / len) * walk;
      }
      const tapped = this.tapped;
      for (let i = 0; i < KEY_ENTRIES.length; i++) {
        const code = KEY_ENTRIES[i][0];
        if (k.has(code) || tapped.has(code)) held[KEY_ENTRIES[i][1]] = true;
      }

      // The left stick pushed furthest across the pads read overrides the keys.
      const pads = this._gamepads();
      let px = 0;
      let py = 0;
      let pm = DEADZONE;
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        const ax = pad.axes[0] || 0;
        const ay = -(pad.axes[1] || 0);
        const m = Math.hypot(ax, ay);
        if (m > pm) {
          pm = m;
          px = ax;
          py = ay;
        }
        this._padButtons(pad, held);
      }
      if (pm > DEADZONE) {
        const scaled = Math.min(1, (pm - DEADZONE) / (1 - DEADZONE));
        sx = (px / pm) * scaled;
        sy = (py / pm) * scaled;
      }
    } else {
      for (const b of BUTTONS) held[b] = false;
    }
    this.tapped.clear();

    if (this.override) {
      const o = this.override;
      if (typeof o.stickX === 'number') sx = o.stickX;
      if (typeof o.stickY === 'number') sy = o.stickY;
      for (let i = 0; i < BUTTONS.length; i++) if (o[BUTTONS[i]]) held[BUTTONS[i]] = true;
    }

    let mag = Math.hypot(sx, sy);
    if (mag > 1) {
      sx /= mag;
      sy /= mag;
      mag = 1;
    }

    const out = { stickX: sx, stickY: sy, stickMag: mag, mouseDX: this.mouseDX, mouseDY: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    for (let i = 0; i < BUTTONS.length; i++) {
      const btn = BUTTONS[i];
      const down = held[btn];
      out[btn] = { down, pressed: down && !this.prev[btn], released: !down && this.prev[btn] };
      this.prev[btn] = down;
    }
    return out;
  }

  dispose() {
    const t = this.target;
    t.removeEventListener('keydown', this._onKeyDown);
    t.removeEventListener('keyup', this._onKeyUp);
    t.removeEventListener('blur', this._onBlur);
    t.removeEventListener('mousedown', this._onMouseDown);
    t.removeEventListener('mouseup', this._onMouseUp);
    t.removeEventListener('mousemove', this._onMouseMove);
    t.removeEventListener('contextmenu', this._onContext);
  }
}

// A neutral controller snapshot (useful for tests and cutscenes).
export function neutralController() {
  const out = { stickX: 0, stickY: 0, stickMag: 0, mouseDX: 0, mouseDY: 0 };
  for (const b of BUTTONS) out[b] = { down: false, pressed: false, released: false };
  return out;
}
