// Automatic actions that take over positioning: ledge hang / climb, holding a pole,
// death and the star celebration.

import { angleDiff, approach, clamp, lerp, smoothstep, wrapAngle } from '../../core/math.js';
import * as T from '../physics/tuning.js';
import { airStep, groundStep, STEP_LANDED, STEP_LEFT_GROUND } from '../physics/step.js';
import { applyGravity, setForwardVel } from '../physics/movement.js';

function stop(p) {
  setForwardVel(p, 0);
  p.vel.y = 0;
}

// Hanging from a ledge (arg from tryLedgeGrab: { y: ledge top, hn: wall normal, climbTo }).
// A grab made below the hang point (the feet swept past it this tick) snaps up to it; one
// made above it sinks in over the first ticks.
const ledgeHang = {
  group: 'automatic',
  anim: 'ledge_hang',
  enter(p, ledge) {
    p.ledge = ledge;
    p.faceYaw = Math.atan2(-ledge.hn.x, -ledge.hn.z);
    p.pos.y = Math.max(p.pos.y, ledge.y - T.HANG_DEPTH);
    stop(p);
    p.sfx('ledge_grab');
  },
  update(p, c) {
    p.pos.y = approach(p.pos.y, p.ledge.y - T.HANG_DEPTH, T.HANG_SETTLE_SPEED);
    if (p.actionTimer < 3) return false;
    const toward = p.stickHeld ? Math.cos(angleDiff(p.faceYaw, p.intendedYaw)) : 0;
    if (c.A.pressed || (toward > 0.5 && p.actionTimer >= 10)) return p.setAction('ledge_climb');
    if (c.Z.pressed || toward < -0.5) {
      p.grabCooldownUntil = p.tick + T.GRAB_COOLDOWN;
      p.pos.x += p.ledge.hn.x * 10;
      p.pos.z += p.ledge.hn.z * 10;
      p.setAction('freefall');
    }
    return false;
  },
};

// Pulls up onto the ledge: rise first, then step forward onto the spot tryLedgeGrab checked.
const ledgeClimb = {
  group: 'automatic',
  anim: 'ledge_climb',
  enter(p) {
    p.climbFrom = { ...p.pos };
    p.climbTo = p.ledge.climbTo;
    p.sfx('climb');
  },
  update(p) {
    const t = (p.actionTimer + 1) / T.LEDGE_CLIMB_TICKS;
    const a = p.climbFrom;
    const b = p.climbTo;
    const up = smoothstep(0, 0.6, t);
    const fwd = smoothstep(0.35, 1, t);
    p.pos.x = lerp(a.x, b.x, fwd);
    p.pos.y = lerp(a.y, b.y, up);
    p.pos.z = lerp(a.z, b.z, fwd);
    if (t >= 1) {
      p.floor = p.collision.findFloor(p.pos.x, p.pos.y + 10, p.pos.z);
      p.grounded = true;
      p.setAction('idle');
    }
    return false;
  },
};

// Holding a tree trunk / pole (arg: the pole). Stick up climbs, down slides, sideways orbits.
const pole = {
  group: 'automatic',
  anim: 'pole_hold',
  enter(p, target) {
    p.pole = target;
    p.faceYaw = Math.atan2(target.x - p.pos.x, target.z - p.pos.z);
    p.poleY = clamp(p.pos.y, target.y0, poleTop(target));
    stop(p);
    placeOnPole(p);
    p.sfx('climb');
  },
  update(p, c) {
    if (p.actionTimer >= 2) {
      if (c.A.pressed) return p.setAction('pole_jump');
      if (c.Z.pressed) {
        p.grabCooldownUntil = p.tick + T.GRAB_COOLDOWN;
        return p.setAction('freefall');
      }
    }
    let anim = 'pole_hold';
    const top = poleTop(p.pole);
    if (c.stickY > 0.2 && p.poleY < top) {
      p.poleY = Math.min(top, p.poleY + T.POLE_CLIMB_SPEED * c.stickY);
      p.cyclePhase += c.stickY * 0.08;
      anim = 'pole_climb';
    } else if (c.stickY < -0.2) {
      p.poleY += T.POLE_SLIDE_SPEED * c.stickY;
    }
    p.faceYaw = wrapAngle(p.faceYaw - c.stickX * 0.08);
    placeOnPole(p);
    p.setAnim(anim);
    p.floor = p.collision.findFloor(p.pos.x, p.poleY + 10, p.pos.z);
    if (p.floor.surface && p.poleY <= p.floor.y) {
      p.pos.y = p.floor.y;
      p.grounded = true;
      p.grabCooldownUntil = p.tick + T.GRAB_COOLDOWN;
      p.setAction('idle');
    }
    return false;
  },
};

function poleTop(target) {
  return Math.max(target.y0, target.y1 - T.HANG_DEPTH);
}

function placeOnPole(p) {
  const d = p.pole.radius + T.POLE_HOLD_DIST;
  p.pos.x = p.pole.x - Math.sin(p.faceYaw) * d;
  p.pos.y = p.poleY;
  p.pos.z = p.pole.z - Math.cos(p.faceYaw) * d;
}

// Falls (or floats, in water) with gravity only; used by non-interactive poses.
function settle(p) {
  if (p.pos.y < p.waterLevel - T.WATER_ENTER_DEPTH) return;
  setForwardVel(p, 0);
  if (p.grounded) {
    if (groundStep(p).result !== STEP_LEFT_GROUND) return;
  }
  if (airStep(p).result !== STEP_LANDED) applyGravity(p);
}

// Out of health: collapse, then respawn after DEATH_TICKS.
const death = {
  group: 'automatic',
  anim: 'death',
  enter(p) {
    stop(p);
    p.emit('lifeLost', {});
  },
  update(p) {
    settle(p);
    if (p.actionTimer >= T.DEATH_TICKS) p.respawn();
    return false;
  },
};

const starDance = {
  group: 'automatic',
  anim: 'star_dance',
  enter(p) {
    stop(p);
  },
  update(p) {
    settle(p);
    if (p.actionTimer >= 80) p.setAction(p.grounded ? 'idle' : 'freefall');
    return false;
  },
};

export const AUTOMATIC_ACTIONS = {
  ledge_hang: ledgeHang,
  ledge_climb: ledgeClimb,
  pole,
  death,
  star_dance: starDance,
};
