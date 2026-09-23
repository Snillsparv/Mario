// Swimming: tank controls under water (stick X turns, stick Y pitches with stick up = nose
// down), breaststroke bursts on A, flutter kick while A is held, slow buoyancy, and floating
// at the surface, where A strokes along the surface, A with the stick pulled back (nose up)
// jumps out and A with the stick pushed up (or Z) dives.

import { approach, clamp, wrapAngle } from '../../core/math.js';
import * as T from '../physics/tuning.js';
import { waterStep } from '../physics/step.js';
import { setForwardVel } from '../physics/movement.js';
import { isSteep } from '../physics/slopes.js';

// Called by the player when the feet sink WATER_ENTER_DEPTH below the surface.
export function enterWater(p) {
  const fromAir = !p.grounded;
  p.emit('splash', { pos: { x: p.pos.x, y: p.waterLevel, z: p.pos.z }, big: fromAir && p.vel.y < -30 });
  p.swimPitch = 0;
  p.forwardVel = Math.hypot(p.vel.x, p.vel.z) * 0.5;
  p.waterVy = fromAir ? p.vel.y : 0;
  p.atSurface = false;
  p.grounded = false;
  p.setAction(fromAir ? 'swim_idle' : 'water_surface');
}

// Stands up when the water gets shallow over a floor he can stand on (steep banks can't be
// waded up: the water step treats them as walls); drops out if the water volume ends.
// Returns true when the hero left the water.
function leaveWater(p, r) {
  if (r.noWater) {
    p.setAction('freefall');
    return true;
  }
  const level = p.collision.waterLevelAt(p.pos.x, p.pos.z);
  const shallow = p.floor.surface && p.floor.y >= level - T.WATER_EXIT_DEPTH;
  if (shallow && !isSteep(p.floor) && p.pos.y - p.floor.y < 30) {
    p.pos.y = p.floor.y;
    p.grounded = true;
    p.swimPitch = 0;
    setForwardVel(p, clamp(p.forwardVel, 0, T.FLUTTER_SPEED));
    p.setAction(p.stickHeld ? 'walking' : 'idle');
    return true;
  }
  return false;
}

// Stick X turns, stick Y pitches; at the surface the nose levels out instead of pointing up.
function swimSteer(p, c) {
  p.faceYaw = wrapAngle(p.faceYaw - c.stickX * T.SWIM_TURN_RATE);
  p.swimPitch = approach(p.swimPitch, c.stickY * T.SWIM_MAX_PITCH, T.SWIM_PITCH_RATE);
  if (p.atSurface && p.swimPitch < 0) p.swimPitch = Math.min(0, p.swimPitch + 3 * T.SWIM_PITCH_RATE);
}

// Moves along the swim pitch plus buoyancy; drifting up into the surface floats there
// (a stroke carries on along the surface when `strokeAtSurface`).
function swimMove(p, strokeAtSurface = false) {
  p.waterVy = approach(p.waterVy, T.BUOYANCY, T.PLUNGE_DAMPING);
  const cp = Math.cos(p.swimPitch);
  p.vel.x = p.forwardVel * cp * Math.sin(p.faceYaw);
  p.vel.z = p.forwardVel * cp * Math.cos(p.faceYaw);
  p.vel.y = -p.forwardVel * Math.sin(p.swimPitch) + p.waterVy;
  const r = waterStep(p);
  p.atSurface = r.atSurface;
  p.pitch = p.swimPitch;
  if (leaveWater(p, r)) return false;
  if (r.atSurface && p.vel.y >= 0 && !strokeAtSurface) p.setAction('water_surface');
  return false;
}

const swimIdle = {
  group: 'submerged',
  anim: 'swim_idle',
  update(p, c) {
    if (c.A.pressed) return p.setAction('swim_stroke');
    swimSteer(p, c);
    p.forwardVel = approach(p.forwardVel, 0, 0.35);
    return swimMove(p);
  },
};

// Breaststroke: a burst of speed, then a glide. Pressing A again mid-glide re-strokes (or,
// at the surface with the stick pulled back, jumps out).
const swimStroke = {
  group: 'submerged',
  enter(p) {
    p.setAnim('swim_stroke', true);
    p.sfx('swim');
  },
  update(p, c) {
    if (c.A.pressed && p.actionTimer >= 10) return p.setAction(p.atSurface && c.stickY < -0.5 ? 'water_jump' : 'swim_stroke');
    if (p.actionTimer >= T.STROKE_TICKS) {
      if (p.atSurface) return p.setAction('water_surface');
      return p.setAction(c.A.down ? 'swim_flutter' : 'swim_idle');
    }
    swimSteer(p, c);
    if (p.actionTimer < T.STROKE_BURST_TICKS) p.forwardVel = Math.min(p.forwardVel + T.STROKE_ACCEL, T.STROKE_MAX_SPEED);
    else p.forwardVel = approach(p.forwardVel, 0, 0.4);
    p.cyclePhase += 1 / T.STROKE_TICKS;
    return swimMove(p, true);
  },
};

const swimFlutter = {
  group: 'submerged',
  anim: 'swim_flutter',
  update(p, c) {
    if (c.A.pressed) return p.setAction('swim_stroke');
    if (!c.A.down) return p.setAction('swim_idle');
    swimSteer(p, c);
    p.forwardVel = approach(p.forwardVel, T.FLUTTER_SPEED, 1);
    p.cyclePhase += 1 / 12;
    return swimMove(p);
  },
};

// Floating with the head above water: paddle forward (flutter kick while A is held) and
// turn. A strokes along the surface; with the stick pulled back it jumps out, with the
// stick pushed up (or Z) it dives back under.
const waterSurface = {
  group: 'submerged',
  anim: 'water_surface',
  enter(p) {
    p.swimPitch = 0;
    p.waterVy = 0;
    p.atSurface = true;
  },
  update(p, c) {
    if (c.A.pressed) {
      if (c.stickY < -0.5) return p.setAction('water_jump');
      p.atSurface = c.stickY <= 0.5;
      p.swimPitch = p.atSurface ? 0 : 0.6;
      return p.setAction('swim_stroke');
    }
    if (c.Z.pressed) {
      p.swimPitch = 0.9;
      p.forwardVel = Math.max(p.forwardVel, 10);
      return p.setAction('swim_idle');
    }
    p.faceYaw = wrapAngle(p.faceYaw - c.stickX * T.SWIM_TURN_RATE);
    const target = c.A.down ? T.FLUTTER_SPEED : Math.max(0, c.stickY) * T.SURFACE_PADDLE_SPEED;
    p.forwardVel = approach(p.forwardVel, target, 0.6);
    p.swimPitch = 0;
    p.waterVy = 0;
    const floatY = p.waterLevel - T.SURFACE_FLOAT_DEPTH;
    p.vel.x = p.forwardVel * Math.sin(p.faceYaw);
    p.vel.z = p.forwardVel * Math.cos(p.faceYaw);
    p.vel.y = clamp(floatY - p.pos.y, -8, 8);
    const r = waterStep(p);
    p.vel.y = 0;
    p.cyclePhase += 0.03 + p.forwardVel / 150;
    leaveWater(p, r);
    return false;
  },
};

export const SUBMERGED_ACTIONS = {
  swim_idle: swimIdle,
  swim_stroke: swimStroke,
  swim_flutter: swimFlutter,
  water_surface: waterSurface,
};
