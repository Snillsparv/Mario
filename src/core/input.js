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

    this._onKeyDown = (e) => {
      if (e.code in KEYMAP || /^Key[WASDQ]$/.test(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.tapped.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => {
      this.keys.clear();
      this.tapped.clear();
    };
    this._onMouseDown = (e) => {
      if (e.button === 0 || e.button === 2) this.dragging = true;
    };
    this._onMouseUp = () => {
      this.dragging = false;
    };
    this._onMouseMove = (e) => {
      if (!this.dragging) return;
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

  _gamepad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
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
    const pad = this._gamepad();
    if (pad) this._padButtons(pad, this.padLatch);
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

      const pad = this._gamepad();
      if (pad) {
        const ax = pad.axes[0] || 0;
        const ay = -(pad.axes[1] || 0);
        const m = Math.hypot(ax, ay);
        if (m > DEADZONE) {
          const scaled = Math.min(1, (m - DEADZONE) / (1 - DEADZONE));
          sx = (ax / m) * scaled;
          sy = (ay / m) * scaled;
        }
        this._padButtons(pad, held);
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
