// Virtual N64-style controller built from keyboard, mouse and gamepad input.
//
// poll() is called once per 30 Hz simulation tick and returns a snapshot:
//   {
//     stickX, stickY,   // -1..1, stick up = +1 (after deadzone, clamped to the unit circle)
//     stickMag,         // 0..1
//     rawStickMag,      // stickMag before the keyboard ease-in (>= stickMag; the same for a pad)
//     A, B, Z, R, START, CU, CD, CL, CR: { down, pressed, released }
//     mouseDX, mouseDY  // accumulated mouse drag since the last poll (pixels), for camera orbit
//   }
//
// Keyboard: WASD move (eased in from rest, see KEY_RAMP_*), Q = walk slowly, Space/K = A (jump),
// J = B (punch/dive/read a sign), Shift/L = Z (crouch/ground pound), arrow keys = C buttons
// (camera), C = R (camera mode), Enter/Esc = Start, mouse drag = camera orbit. Gamepad
// (standard mapping): left stick, A = A, X/B = B, triggers = Z, right stick = C buttons,
// RB = R, Start = Start. Nintendo-style pads (padLayout): the button on the right (labelled A)
// jumps and the one at the bottom (labelled B) attacks; see padLayout below.
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
//
// Touch screens (ui/TouchController.js): setTouchState({ stickX, stickY, A, B, Z, R, START,
// CU, CD, CL, CR }) whenever the on-screen controller changes. It is merged like one more
// gamepad: buttons OR'ed in, its stick used when pushed further than the keys/pads. Every
// button seen down is latched until the next poll, so a tap shorter than a tick still reads
// as a press (like a key). addLookDelta(dx, dy) adds a drag on the picture to the mouse-drag
// camera orbit (mouseDX / mouseDY).
//
// A phone used as a controller over the local network (net/RemotePad.js): setRemoteState(same
// shape | null) is a separate channel merged exactly like the touch state (buttons OR'ed and
// latched until the next poll, its stick used when pushed at least as far as the others);
// null (the phone left) releases everything it held.

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

// Keyboard stick ease-in. A digital key would slam the virtual stick to full at once;
// instead a direction key pressed from rest pushes the stick from KEY_RAMP_START to full over
// KEY_RAMP_TICKS polls on an ease-in curve, like easing an analog stick forward. The ramp is
// short (round 3: the start felt "hard"): the hero's own start curve (walkAccel in
// player/physics/movement.js) does the tiptoe -> walk -> run easing, and the ramp stays just
// above that curve, so it never holds the speed back; it only keeps the first polls a light
// push (the gait shows a tiptoe), as a thumb easing a real stick would. Only the magnitude
// ramps: the direction always follows the keys at once (turning never lags), releasing every
// key drops the stick to neutral at once, and keys pressed again within KEY_RAMP_GRACE polls
// (switching W to S for a turnaround, say) carry on from where the ramp was. Gamepad sticks
// keep their analog value.
// The snapshot also carries rawStickMag, the keys' full push (the stick is eased in along the
// same direction): the hero uses it for stick thresholds that must not wait for the ramp
// (jumping out of / diving under the water with S / W + jump) and once he already moves
// faster than the eased stick asks for (see Player.readInput).
export const KEY_RAMP_TICKS = 7; // ~0.23 s at 30 polls per second (was 11)
export const KEY_RAMP_START = 0.3; // first poll: already moves and turns the hero
export const KEY_RAMP_GRACE = 4; // polls without a direction key before the ramp restarts

// Which button layout a gamepad reports (see _padButtons):
//   'standard'  the standard mapping (buttons by position: 0 bottom, 1 right, 2 left, 3 top),
//               an Xbox-style pad: the bottom button (A) jumps, right or left (B / X) attack
//   'nintendo'  the standard mapping on a Nintendo-style pad (its id names Nintendo, a Switch
//               or Pro Controller, or a Switch pad maker): the right button (labelled A)
//               jumps, the bottom one (labelled B) attacks
//   'raw'       no standard mapping: the pad's own order, read as a Switch-style pad reports
//               it (0 Y left, 1 B bottom, 2 A right, 3 X top, 4 L, 5 R, 6 ZL, 7 ZR, 8 -, 9 +):
//               right (A) jumps, bottom (B) attacks; the left and top buttons do nothing
const NINTENDO_PAD = /nintendo|switch|pro controller|joy-?con|vendor: ?057e|vendor: ?0f0d|horipad/i;
export function padLayout(pad) {
  if (!pad || pad.mapping !== 'standard') return 'raw';
  return NINTENDO_PAD.test(pad.id || '') ? 'nintendo' : 'standard';
}

function browserGamepads() {
  return typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
}

// A stick axis from outside: -1..1, anything else (undefined, NaN) = 0.
function unitAxis(v) {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

function buttonRecord() {
  const r = {};
  for (const b of BUTTONS) r[b] = false;
  return r;
}

// Copy an outside controller state ({ stickX, stickY, A, ... } or null = released) into a
// virtual pad channel `t`; buttons seen down are latched until the next poll (when `latch`).
function copyVirtual(t, latchRec, state, latch) {
  t.stickX = unitAxis(state?.stickX);
  t.stickY = unitAxis(state?.stickY);
  for (let i = 0; i < BUTTONS.length; i++) {
    const b = BUTTONS[i];
    const down = !!state?.[b];
    t[b] = down;
    if (down && latch) latchRec[b] = true;
  }
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
    this.keyRamp = 0; // keyboard stick ease-in progress 0..1 (see KEY_RAMP_*)
    this.keyIdlePolls = Infinity; // polls since a direction key was last held
    this.getGamepads = browserGamepads; // replaceable (tests)
    this._pads = []; // scratch: the pads read this poll/sample
    this.touch = { stickX: 0, stickY: 0, ...buttonRecord() }; // on-screen controller (setTouchState)
    this.touchLatch = buttonRecord(); // touch buttons seen down since the last poll
    this.remote = { stickX: 0, stickY: 0, ...buttonRecord() }; // phone controller (setRemoteState)
    this.remoteLatch = buttonRecord(); // phone buttons seen down since the last poll

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

  // The touch controller's current state (null = released). Values are copied: the caller may
  // reuse its object. Sticks are -1..1 (y up) with the dead zone already applied.
  setTouchState(state) {
    copyVirtual(this.touch, this.touchLatch, state, this.enabled);
  }

  // The phone controller's current state (net/RemotePad.js), same shape as setTouchState;
  // null = the phone let go or left (everything released). Values are copied.
  setRemoteState(state) {
    copyVirtual(this.remote, this.remoteLatch, state, this.enabled);
  }

  // A drag on the game picture (touch), in CSS px: orbits the camera like a mouse drag.
  addLookDelta(dx, dy) {
    if (!this.enabled) return;
    this.mouseDX += dx || 0;
    this.mouseDY += dy || 0;
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
    const layout = padLayout(pad);
    if (layout === 'standard') {
      if (b(0)) out.A = true;
      if (b(1) || b(2)) out.B = true;
    } else if (layout === 'nintendo') {
      if (b(1)) out.A = true;
      if (b(0)) out.B = true;
    } else {
      if (b(2)) out.A = true;
      if (b(1)) out.B = true;
    }
    if (b(6) || b(7) || b(4)) out.Z = true;
    if (b(5)) out.R = true;
    if (b(9)) out.START = true;
    const rx = pad.axes[2] || 0;
    const ry = pad.axes[3] || 0;
    // (The d-pad is buttons 12-15 only in the standard mapping; a raw pad has Home and
    // Capture there.)
    const dpad = layout !== 'raw';
    if (rx < -0.5 || (dpad && b(14))) out.CL = true;
    if (rx > 0.5 || (dpad && b(15))) out.CR = true;
    if (ry < -0.5 || (dpad && b(12))) out.CU = true;
    if (ry > 0.5 || (dpad && b(13))) out.CD = true;
  }

  // Advances the keyboard stick ease-in by one poll (direction keys held or not) and returns
  // the stick magnitude for held keys.
  _keyStick(held) {
    if (!held) {
      this.keyIdlePolls++;
      return 0;
    }
    if (this.keyIdlePolls > KEY_RAMP_GRACE) this.keyRamp = 0;
    this.keyIdlePolls = 0;
    // (Rounded so that KEY_RAMP_TICKS float steps land exactly on 1.)
    this.keyRamp = Math.min(1, Math.round((this.keyRamp + 1 / KEY_RAMP_TICKS) * 1e9) / 1e9);
    return KEY_RAMP_START + (1 - KEY_RAMP_START) * this.keyRamp * this.keyRamp;
  }

  // Call once per render frame: latches gamepad buttons that are held now, so a flick
  // shorter than a 30 Hz tick still reaches the next poll().
  sample() {
    if (!this.enabled) return;
    const pads = this._gamepads();
    for (let i = 0; i < pads.length; i++) this._padButtons(pads[i], this.padLatch);
    for (let i = 0; i < BUTTONS.length; i++) {
      const b = BUTTONS[i];
      if (this.touch[b]) this.touchLatch[b] = true;
      if (this.remote[b]) this.remoteLatch[b] = true;
    }
  }

  // Forget latched taps and the previous button state (held buttons will not read as
  // freshly pressed). Used when gameplay (re)starts after a menu.
  flush() {
    this.tapped.clear();
    for (const b of BUTTONS) {
      this.padLatch[b] = false;
      this.touchLatch[b] = false;
      this.remoteLatch[b] = false;
    }
    this.poll();
  }

  poll() {
    let sx = 0;
    let sy = 0;
    let raw = 0; // the stick's magnitude before the keyboard ease-in
    const held = this.held;
    const touch = this.touch;
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
        raw = k.has('KeyQ') ? 0.45 : 1;
        const m = raw * this._keyStick(true);
        sx = (sx / len) * m;
        sy = (sy / len) * m;
      } else {
        this._keyStick(false);
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
        raw = scaled;
      }

      // The touch controller: one more pad (its buttons OR'ed in, latched taps included; its
      // stick, already dead-zoned, wins when pushed further than the keys or pads).
      for (let i = 0; i < BUTTONS.length; i++) {
        const b = BUTTONS[i];
        if (touch[b] || this.touchLatch[b]) held[b] = true;
      }
      const tm = Math.hypot(touch.stickX, touch.stickY);
      if (tm > 0 && tm >= raw) {
        sx = touch.stickX;
        sy = touch.stickY;
        raw = Math.min(1, tm);
      }

      // The phone controller (setRemoteState): merged the same way, after the touch one.
      const remote = this.remote;
      for (let i = 0; i < BUTTONS.length; i++) {
        const b = BUTTONS[i];
        if (remote[b] || this.remoteLatch[b]) held[b] = true;
      }
      const rm = Math.hypot(remote.stickX, remote.stickY);
      if (rm > 0 && rm >= raw) {
        sx = remote.stickX;
        sy = remote.stickY;
        raw = Math.min(1, rm);
      }
    } else {
      for (const b of BUTTONS) held[b] = false;
      this._keyStick(false);
    }
    for (let i = 0; i < BUTTONS.length; i++) {
      this.touchLatch[BUTTONS[i]] = false;
      this.remoteLatch[BUTTONS[i]] = false;
    }
    this.tapped.clear();

    if (this.override) {
      const o = this.override;
      if (typeof o.stickX === 'number') sx = o.stickX;
      if (typeof o.stickY === 'number') sy = o.stickY;
      if (typeof o.stickX === 'number' || typeof o.stickY === 'number') raw = Math.hypot(sx, sy);
      for (let i = 0; i < BUTTONS.length; i++) if (o[BUTTONS[i]]) held[BUTTONS[i]] = true;
    }

    let mag = Math.hypot(sx, sy);
    if (mag > 1) {
      sx /= mag;
      sy /= mag;
      mag = 1;
    }

    const rawStickMag = mag > 0 ? Math.min(1, Math.max(raw, mag)) : 0;
    const out = { stickX: sx, stickY: sy, stickMag: mag, rawStickMag, mouseDX: this.mouseDX, mouseDY: this.mouseDY };
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
  const out = { stickX: 0, stickY: 0, stickMag: 0, rawStickMag: 0, mouseDX: 0, mouseDY: 0 };
  for (const b of BUTTONS) out[b] = { down: false, pressed: false, released: false };
  return out;
}
