// AI RACE look-up (cameraConfig LOOKUP_*). While AI RACE mode is on (main's 'darkMode' { on })
// the robot beast sprawls on the castle's front roof with its head out over the courtyard, some
// 3200 above the ground: from the default follow view near the castle it is far above the top of
// the picture. So once it has risen (LOOKUP_DELAY ticks after the mode switched on), a hero within
// LOOKUP_ZONE of the castle front, near the ground, with the camera facing the castle, gets a view
// framed to take in the beast's head (`head`, LOOKUP_HEAD_*) as well as himself:
//   * the orbit drops to about his head height (`drop`, off the orbit pitch),
//   * the view tilts up just enough to bring the head down to LOOKUP_HEAD_NDC of the picture's
//     height (CameraController._aimTarget, from where the camera really is), and his feet may
//     sit down to LOOKUP_FEET_NDC (near the bottom edge; `feetBelow` / `feetHardBelow`),
//   * where that is not enough (closer in, the head towers right overhead) the camera moves out
//     (`dist`, up to LOOKUP_DIST_MAX) and the view widens (`fov`, up to LOOKUP_FOV_MAX) just
//     enough that both fit (`u`: how far, 0..1, solved each tick from the geometry); right under
//     the head, on the courtyard, even that is not enough: his feet stay in the picture and the
//     head is cut at the top (its neck and jaw loom in).
// The weight `w` eases in and out with the zone, the facing, the height, a flight or a star
// celebration (they have their own framing) and the mode. Without AI RACE mode it stays exactly
// 0, so the sunny framing (and field of view) is unchanged.
//
// State for CameraController (numbers only: no per-tick garbage).

import { angleDiff, smoothstep } from '../core/math.js';
import * as layout from '../world/layout.js';
import * as K from './cameraConfig.js';

const C = layout.CASTLE;
const TARGET_X = C.x;
const TARGET_Z = C.frontZ - K.LOOKUP_TARGET_BACK;
const DEG = Math.PI / 180;

// The beast's head as it lies on the roof (the framing target; tests check it against the model).
export const BEAST_HEAD = Object.freeze({
  x: layout.KAIJU ? layout.KAIJU.x : C.x,
  y: C.baseY + K.LOOKUP_HEAD_UP,
  z: C.frontZ + K.LOOKUP_HEAD_OUT,
});

// Vertical angle from the view axis to NDC height `ndc` for a field of view `fov` (degrees).
export function ndcAngle(ndc, fov) {
  return Math.atan(ndc * Math.tan((fov * DEG) / 2));
}

export class LookUp {
  constructor(events) {
    this.on = false; // AI RACE mode as last switched
    this.ticks = 0; // ticks since it switched on
    this.w = 0; // eased weight 0..1...
    this.vel = 0; // ...and its last change per tick
    this.u = 0; // how far the pull-back and the wider view go (0..1), where the tilt is not enough
    this.fresh = true; // set outright on the next tick (a reset: respawn, level start)
    this.head = BEAST_HEAD;
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
  // hero to the camera); base: the orbit distance without the look-up; focusY: the framed feet
  // height; flight: the flight camera's weight; busy: a star celebration has the camera.
  update(hero, yaw, dist, base, focusY, flight, busy = false) {
    if (this.on) this.ticks++;
    const on = this.on && this.ticks > K.LOOKUP_DELAY && flight < 1 && !busy && !!layout.KAIJU;
    const goal = on ? (1 - flight) * zone(hero, yaw, dist, focusY) : 0;
    if (this.fresh) {
      this.w = goal;
      this.vel = 0;
    } else if (goal !== this.w) {
      // Exponential ease with a small minimum step, so it arrives (at exactly 0 once off), its
      // speed ramping up by at most LOOKUP_ACCEL per tick (it sets off gently too).
      const dir = goal > this.w ? 1 : -1;
      const want = Math.max(Math.abs(goal - this.w) * (dir > 0 ? K.LOOKUP_IN_RATE : K.LOOKUP_OUT_RATE), K.LOOKUP_MIN_STEP);
      const speed = Math.min(want, Math.max(0, this.vel * dir) + K.LOOKUP_ACCEL);
      this.w = dir > 0 ? Math.min(goal, this.w + speed) : Math.max(goal, this.w - speed);
      this.vel = this.w === goal ? 0 : dir * speed;
    } else this.vel = 0;
    this.fresh = false;
    // (Solved while it has any weight: it eases in and out with it.)
    this.u = this.w > 0 ? spread(hero, focusY, base) : 0;
    this._apply();
  }

  _apply() {
    const w = this.w;
    const wu = w * this.u;
    this.drop = w * K.LOOKUP_PITCH_DROP; // off the orbit pitch
    this.dist = wu * K.LOOKUP_DIST_MAX; // added to the orbit distance
    this.fov = K.FOV + wu * (K.LOOKUP_FOV_MAX - K.FOV); // field of view (degrees)
    this.feetBelow = K.FEET_MAX_BELOW + w * (ndcAngle(K.LOOKUP_FEET_NDC, this.fov) - K.FEET_MAX_BELOW);
    this.feetHardBelow = K.FEET_HARD_BELOW + w * (ndcAngle(K.LOOKUP_FEET_HARD_NDC, this.fov) - K.FEET_HARD_BELOW);
    this.headAbove = ndcAngle(K.LOOKUP_HEAD_NDC, this.fov); // the head this far over the view axis, at most
  }
}

// Horizontal distance from the front of the castle (a hero beside the castle counts his distance
// across only).
function frontDistance(hero) {
  const dx = hero.x - C.x;
  const dz = Math.max(0, hero.z - C.frontZ);
  return Math.sqrt(dx * dx + dz * dz);
}

// 0..1: within the zone, near the ground, and the camera (on the orbit at `yaw`, `dist` out)
// faces the castle front.
function zone(hero, yaw, dist, focusY) {
  const near = 1 - smoothstep(K.LOOKUP_ZONE[0], K.LOOKUP_ZONE[1], frontDistance(hero));
  if (near === 0) return 0;
  const low = 1 - smoothstep(K.LOOKUP_HEIGHT[0], K.LOOKUP_HEIGHT[1], focusY - C.baseY);
  if (low === 0) return 0;
  const tx = TARGET_X - (hero.x + Math.sin(yaw) * dist);
  const tz = TARGET_Z - (hero.z + Math.cos(yaw) * dist);
  if (tx * tx + tz * tz < 1) return near * low;
  const off = Math.abs(angleDiff(yaw + Math.PI, Math.atan2(tx, tz)));
  return near * low * (1 - smoothstep(K.LOOKUP_FACING[0], K.LOOKUP_FACING[1], off));
}

// How far (0..1) the pull-back and the wider view must go for the beast's head and the hero's
// feet to fit in the picture together (see top), from a camera `base` + the pull-back behind
// him, LOOKUP_CAM_UP over his feet, on the far side of him from the head: the smallest that fits
// (bisection), or 1.
function spread(hero, focusY, base) {
  const dx = BEAST_HEAD.x - hero.x;
  const dz = BEAST_HEAD.z - hero.z;
  const s = Math.sqrt(dx * dx + dz * dz);
  const rise = BEAST_HEAD.y - (focusY + K.LOOKUP_CAM_UP);
  if (fits(0, s, rise, base)) return 0;
  if (!fits(1, s, rise, base)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid, s, rise, base)) hi = mid;
    else lo = mid;
  }
  return hi;
}

function fits(u, s, rise, base) {
  const d = base + u * K.LOOKUP_DIST_MAX;
  const fov = K.FOV + u * (K.LOOKUP_FOV_MAX - K.FOV);
  const need = Math.atan2(rise, s + d) + Math.atan2(K.LOOKUP_CAM_UP, d);
  return need <= ndcAngle(K.LOOKUP_HEAD_NDC, fov) + ndcAngle(K.LOOKUP_FEET_NDC, fov);
}
