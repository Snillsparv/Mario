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

const DEADZONE = 0.18;

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.dragging = false;
    this.override = null;
    this.prev = Object.fromEntries(BUTTONS.map((b) => [b, false]));
    this.enabled = true;

    this._onKeyDown = (e) => {
      if (e.code in KEYMAP || /^Key[WASDQ]$/.test(e.code)) e.preventDefault();
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();
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

  poll() {
    let sx = 0;
    let sy = 0;
    const held = Object.fromEntries(BUTTONS.map((b) => [b, false]));

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
      for (const [code, btn] of Object.entries(KEYMAP)) if (k.has(code)) held[btn] = true;

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
        const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
        if (b(0)) held.A = true;
        if (b(1) || b(2)) held.B = true;
        if (b(6) || b(7) || b(4)) held.Z = true;
        if (b(5)) held.R = true;
        if (b(9)) held.START = true;
        const rx = pad.axes[2] || 0;
        const ry = pad.axes[3] || 0;
        if (rx < -0.5) held.CL = true;
        if (rx > 0.5) held.CR = true;
        if (ry < -0.5) held.CU = true;
        if (ry > 0.5) held.CD = true;
        if (b(12)) held.CU = true;
        if (b(13)) held.CD = true;
        if (b(14)) held.CL = true;
        if (b(15)) held.CR = true;
      }
    }

    if (this.override) {
      const o = this.override;
      if (typeof o.stickX === 'number') sx = o.stickX;
      if (typeof o.stickY === 'number') sy = o.stickY;
      for (const btn of BUTTONS) if (o[btn]) held[btn] = true;
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
    for (const btn of BUTTONS) {
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
