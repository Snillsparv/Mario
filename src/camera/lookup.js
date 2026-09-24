// AI RACE look-up (cameraConfig LOOKUP_*). While AI RACE mode is on (main's 'darkMode' { on })
// the robot beast sprawls on the castle's front roof, with its head hanging out over the
// courtyard, 2000-3700 above the ground: from the default follow view near the castle it is
// above the top of the picture. So once it has risen (LOOKUP_DELAY ticks after the mode switched
// on), a hero within LOOKUP_ZONE of the castle front, near the ground, with the camera facing the
// castle, gets a view tilted up by ~12 deg: the orbit drops to about his head height (`drop`, off
// the orbit pitch) and the aim rises (`aim`), and his feet may sit down to LOOKUP_FEET_BELOW under
// the view axis (`feetBelow` / `feetHardBelow`), near the bottom edge. The weight eases in and
// out with the zone, the facing, the height, a flight (the flight camera has its own framing) and
// the mode. Without AI RACE mode it stays exactly 0, so the sunny framing is unchanged.
//
// State for CameraController (numbers only: no per-tick garbage).

import { angleDiff, smoothstep } from '../core/math.js';
import * as layout from '../world/layout.js';
import * as K from './cameraConfig.js';

const C = layout.CASTLE;
const TARGET_X = C.x;
const TARGET_Z = C.frontZ - K.LOOKUP_TARGET_BACK;

export class LookUp {
  constructor(events) {
    this.on = false; // AI RACE mode as last switched
    this.ticks = 0; // ticks since it switched on
    this.w = 0; // eased weight 0..1
    this.fresh = true; // set outright on the next tick (a reset: respawn, level start)
    this._apply();
    events?.on?.('darkMode', (e) => this.setMode(!!e?.on));
  }

  setMode(on) {
    if (on && !this.on) this.ticks = 0;
    this.on = on;
  }

  // A cut (reset): the next update sets the weight outright.
  reset() {
    this.fresh = true;
  }

  // One tick. hero: the camera's hero record; yaw / dist: the orbit's (yaw = direction from the
  // hero to the camera); focusY: the framed feet height; flight: the flight camera's weight.
  update(hero, yaw, dist, focusY, flight) {
    if (this.on) this.ticks++;
    const goal = this.on && this.ticks > K.LOOKUP_DELAY && flight < 1 && layout.KAIJU ? (1 - flight) * zone(hero, yaw, dist, focusY) : 0;
    if (this.fresh) this.w = goal;
    else {
      this.w += (goal - this.w) * (goal > this.w ? K.LOOKUP_IN_RATE : K.LOOKUP_OUT_RATE);
      if (goal === 0 && this.w < 1e-4) this.w = 0;
    }
    this.fresh = false;
    this._apply();
  }

  _apply() {
    const w = this.w;
    this.drop = w * K.LOOKUP_PITCH_DROP; // off the orbit pitch
    this.aim = w * K.LOOKUP_AIM; // added to the aim
    this.feetBelow = K.FEET_MAX_BELOW + w * (K.LOOKUP_FEET_BELOW - K.FEET_MAX_BELOW);
    this.feetHardBelow = K.FEET_HARD_BELOW + w * (K.LOOKUP_FEET_HARD_BELOW - K.FEET_HARD_BELOW);
  }
}

// 0..1: near the castle front (a hero beside the castle counts his distance across only), near
// the ground, and the camera (on the orbit at `yaw`, `dist` out) faces the castle front.
function zone(hero, yaw, dist, focusY) {
  const dx = hero.x - C.x;
  const dz = Math.max(0, hero.z - C.frontZ);
  const near = 1 - smoothstep(K.LOOKUP_ZONE[0], K.LOOKUP_ZONE[1], Math.sqrt(dx * dx + dz * dz));
  if (near === 0) return 0;
  const low = 1 - smoothstep(K.LOOKUP_HEIGHT[0], K.LOOKUP_HEIGHT[1], focusY - C.baseY);
  if (low === 0) return 0;
  const tx = TARGET_X - (hero.x + Math.sin(yaw) * dist);
  const tz = TARGET_Z - (hero.z + Math.cos(yaw) * dist);
  if (tx * tx + tz * tz < 1) return near * low;
  const off = Math.abs(angleDiff(yaw + Math.PI, Math.atan2(tx, tz)));
  return near * low * (1 - smoothstep(K.LOOKUP_FACING[0], K.LOOKUP_FACING[1], off));
}
