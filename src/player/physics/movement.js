// Velocity helpers shared by the actions: walking acceleration, air control, gravity and
// sliding. They only change velocities / facing; the step functions move the hero.

import { angleDiff, approach, approachAngle } from '../../core/math.js';
import * as T from './tuning.js';
import { floorNormal, isSteep, surfaceClass, walkSlopeAccel } from './slopes.js';

const MAX_SLIDE_SPEED = 100;
const SLIDE_STEER = 4; // lateral steering acceleration at full stick while sliding
const SLIDE_TURN_RATE = 0.2;

// Sets forward speed and derives the horizontal velocity from the facing yaw.
export function setForwardVel(p, fv = p.forwardVel) {
  p.forwardVel = fv;
  p.airDrift = 0;
  p.vel.x = fv * Math.sin(p.faceYaw);
  p.vel.z = fv * Math.cos(p.faceYaw);
  p.slideVel.x = p.vel.x;
  p.slideVel.z = p.vel.z;
}

export function stickHeldBack(p) {
  return p.stickHeld && Math.abs(angleDiff(p.faceYaw, p.intendedYaw)) > T.STICK_BACK_ANGLE;
}

// Ground running toward `target` speed (default: the stick's). Below the target the speed
// eases up an exponential curve and is clamped at the target; above it a drag proportional
// to the excess brings it back down (so downhill momentum settles at a higher speed). Slope
// pull comes on top, then the hard speed ceiling and the turn toward the stick.
export function updateWalkingSpeed(p, target = Math.min(p.intendedMag, T.MAX_TARGET_SPEED)) {
  let fv = p.forwardVel;
  const excess = fv - target;
  if (excess < 0) fv = Math.min(target, fv + (T.RUN_ACCEL_LIMIT - fv) / T.RUN_ACCEL_TICKS);
  else fv -= excess * T.RUN_OVERSPEED_DRAG;
  fv = Math.min(fv + walkSlopeAccel(p.floor, p.faceYaw), T.MAX_FORWARD_VEL);
  p.faceYaw = approachAngle(p.faceYaw, p.intendedYaw, T.WALK_TURN_RATE);
  setForwardVel(p, fv);
}

// Friction toward a stop (optionally helped/hindered by the slope).
export function decelerate(p, amount) {
  setForwardVel(p, approach(p.forwardVel, 0, amount));
}

// Air steering with a fixed facing. The stick's component along the facing picks a target
// forward speed in [AIR_MAX_BACK_SPEED, topSpeed] that the speed eases toward (faster when
// pushing toward it, slower when merely coasting); speeds outside the range bleed off. The
// sideways component eases a strafe drift that is added to the velocity, never stored as speed.
export function updateAirControl(p, topSpeed = T.AIR_MAX_SPEED) {
  const m = p.stickHeld ? p.intendedMag / T.MAX_TARGET_SPEED : 0;
  const d = angleDiff(p.faceYaw, p.intendedYaw);
  const along = Math.cos(d) * m;
  const fv = p.forwardVel;
  const target = along >= 0 ? topSpeed * along : -T.AIR_MAX_BACK_SPEED * along;
  let rate = T.AIR_DRAG;
  if (along > 0 && fv < target) rate = T.AIR_SPEEDUP;
  else if (along < 0 && fv > target) rate = T.AIR_BRAKE;
  if (fv > topSpeed) rate = Math.max(rate, T.AIR_OVERSPEED_DECAY);
  p.forwardVel = approach(fv, target, rate);
  p.airDrift = approach(p.airDrift, T.AIR_STRAFE * Math.sin(d) * m, T.AIR_STRAFE_ACCEL);

  // The drift axis is facing + 90 deg (the hero's left), matching positive yaw offsets.
  const s = Math.sin(p.faceYaw);
  const c = Math.cos(p.faceYaw);
  p.vel.x = p.forwardVel * s + p.airDrift * c;
  p.vel.z = p.forwardVel * c - p.airDrift * s;
}

// Gravity with variable jump height: letting go of A while rising fast cuts the jump.
export function applyGravity(p, controlHeight = false, gravity = T.GRAVITY, terminal = T.TERMINAL_VY) {
  if (controlHeight && !p.input.A.down && p.vel.y > T.JUMP_CUT_MIN_VY) p.vel.y *= T.JUMP_CUT_FACTOR;
  else p.vel.y = Math.max(p.vel.y - gravity, terminal);
}

// Slide physics on p.slideVel: slope gravity by surface class, friction, stick steering
// that never adds speed. Returns true once the slide has come to rest on a non-steep floor.
export function updateSliding(p, { loss, flatDecel = 1, stopSpeed = 4 }) {
  const n = floorNormal(p.floor);
  const cls = surfaceClass(p.floor.surface);
  const steep = isSteep(p.floor);
  let sx = p.slideVel.x;
  let sz = p.slideVel.z;
  const h = Math.hypot(n.x, n.z);
  if (h > 1e-4) {
    sx += cls.slideAccel * n.x;
    sz += cls.slideAccel * n.z;
  }
  if (p.stickHeld) {
    const before = Math.hypot(sx, sz);
    const m = (p.intendedMag / T.MAX_TARGET_SPEED) * SLIDE_STEER;
    sx += Math.sin(p.intendedYaw) * m;
    sz += Math.cos(p.intendedYaw) * m;
    const after = Math.hypot(sx, sz);
    if (after > before && after > 0) {
      sx *= before / after;
      sz *= before / after;
    }
  }
  const f = loss ?? cls.slideLoss;
  sx *= f;
  sz *= f;
  let speed = Math.hypot(sx, sz);
  let target = speed;
  if (!steep) target = Math.max(0, speed - flatDecel);
  target = Math.min(target, MAX_SLIDE_SPEED);
  if (speed > 0) {
    sx *= target / speed;
    sz *= target / speed;
  }
  speed = target;
  p.slideVel.x = sx;
  p.slideVel.z = sz;
  p.vel.x = sx;
  p.vel.z = sz;
  if (speed > 1) p.faceYaw = approachAngle(p.faceYaw, Math.atan2(sx, sz), SLIDE_TURN_RATE);
  p.forwardVel = speed;
  return !steep && speed < stopSpeed;
}
