// Automatic actions that take over positioning: ledge hang / climb, holding a pole, the
// handstand on a pole's tip, death and the star celebration (star_fall drops an airborne
// hero first).

import { angleDiff, approach, clamp, lerp, smoothstep, wrapAngle } from '../../core/math.js';
import * as T from '../physics/tuning.js';
import { airStep, clearSpot, groundStep, STEP_LANDED, STEP_LEFT_GROUND } from '../physics/step.js';
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
// Climbing on at the top of the climb (hands at the tip) goes up into the handstand on it.
const pole = {
  group: 'automatic',
  anim: 'pole_hold',
  enter(p, target) {
    p.pole = target;
    p.poleLetGo = 0;
    // Back down from the handstand the hero is on the pole's axis: he keeps his facing.
    const fromTip = p.prevAction === 'pole_top';
    if (!fromTip) p.faceYaw = Math.atan2(target.x - p.pos.x, target.z - p.pos.z);
    p.poleY = clamp(p.pos.y, target.y0, poleTop(target));
    stop(p);
    placeOnPole(p);
    if (fromTip) snapRender(p);
    else p.sfx('climb');
  },
  update(p, c) {
    if (p.poleLetGo > 0) return letGoOfPole(p);
    if (p.actionTimer >= 2) {
      if (c.A.pressed) return p.setAction('pole_jump');
      if (c.Z.pressed) return letGo(p);
    }
    let anim = 'pole_hold';
    const top = poleTop(p.pole);
    // The stick as pushed (no keyboard ease-in: that only softens starting to run).
    const sy = p.rawStickY;
    if (sy > 0.2 && p.poleY >= top && p.actionTimer >= 2) return p.setAction('pole_top');
    if (sy > 0.2) {
      p.poleY = Math.min(top, p.poleY + T.POLE_CLIMB_SPEED * sy);
      p.cyclePhase += sy * 0.08;
      anim = 'pole_climb';
    } else if (sy < -0.2) {
      p.poleY += T.POLE_SLIDE_SPEED * sy;
    }
    p.faceYaw = wrapAngle(p.faceYaw - p.rawStickX * 0.08);
    placeOnPole(p);
    p.setAnim(anim);
    if (p.floor.surface && p.poleY <= p.floor.y) standAtPoleFoot(p);
    return false;
  },
};

// The top of the climb: the feet HANG_DEPTH below the tip, so the hands reach it.
function poleTop(target) {
  return Math.max(target.y0, target.y1 - T.HANG_DEPTH);
}

// No interpolation from the previous tick's placement: entering or leaving the handstand
// moves pos between the feet (holding the trunk) and the hands (on the tip).
function snapRender(p) {
  p.prevPos.x = p.pos.x;
  p.prevPos.y = p.pos.y;
  p.prevPos.z = p.pos.z;
}

// Lets go (Z): eases off the trunk while starting to drop, then falls (the same Z press never
// also starts a ground pound). The fall stays within reach of this trunk, so it can't be
// grabbed again until he lands or drifts out of its reach (letGoPole).
function letGo(p) {
  p.grabCooldownUntil = p.tick + T.GRAB_COOLDOWN;
  p.letGoPole = p.pole;
  p.poleLetGo = 1;
  return letGoOfPole(p);
}

// The handstand on a pole's tip (a tree's crown), reached by climbing on at the top of the
// climb. RenderState during it (anim 'pole_handstand'): pos = the pole tip { pole.x, pole.y1,
// pole.z }, where his hands are (the model draws him upside down above it, facing yaw);
// animTime 0 is the moment he arrives from the top of the climb (hands at the tip, body still
// hanging below them) and he swings up into the balanced handstand over POLE_TOP_SETTLE_TICKS.
// A: a big flip jump off it (pole_top_jump, toward the stick when held, else the facing).
// Stick pulled down (POLE_TOP_DOWN_STICK, once settled): back onto the trunk at the top of
// the climb (action 'pole'). Z: lets go from there, as on the trunk.
const poleTopAction = {
  group: 'automatic',
  anim: 'pole_handstand',
  enter(p) {
    stop(p);
    placeOnTip(p);
    snapRender(p);
    p.grounded = false;
    p.sfx('climb');
  },
  update(p, c) {
    placeOnTip(p);
    if (p.actionTimer >= 2) {
      if (c.A.pressed) return p.setAction('pole_top_jump');
      if (c.Z.pressed) {
        p.setAction('pole', p.pole);
        return letGo(p);
      }
    }
    if (p.actionTimer >= T.POLE_TOP_SETTLE_TICKS && p.rawStickY <= T.POLE_TOP_DOWN_STICK) return p.setAction('pole', p.pole);
    return false;
  },
};

function placeOnTip(p) {
  const pole = p.pole;
  p.pos.x = pole.x;
  p.pos.y = pole.y1;
  p.pos.z = pole.z;
  p.vel.x = p.vel.y = p.vel.z = 0;
  p.floor = p.collision.findFloor(pole.x, pole.y1 + 10, pole.z);
}

function standAtPoleFoot(p) {
  p.pos.y = p.floor.y;
  p.vel.y = 0;
  p.grounded = true;
  p.grabCooldownUntil = p.tick + T.GRAB_COOLDOWN;
  p.setAction('idle');
}

// Letting go (Z): over POLE_LET_GO_TICKS the hero drops under gravity while easing out to
// where the trunk's collider lets him fall, so no air step shoves him out of it.
function letGoOfPole(p) {
  const t = p.poleLetGo / T.POLE_LET_GO_TICKS;
  p.poleLetGo++;
  p.vel.y -= T.GRAVITY;
  p.poleY += p.vel.y;
  placeOnPole(p, smoothstep(0, 1, t));
  p.setAnim('fall');
  if (p.floor.surface && p.poleY <= p.floor.y) standAtPoleFoot(p);
  else if (t >= 1) p.setAction('freefall');
  return false;
}

// Holds the hero POLE_HOLD_DIST off the pole (closer than the trunk's collider lets him
// stand). Over the last POLE_FOOT_BLEND above the floor the hold eases out to the spot where
// he will stand, clear of that collider, so reaching the bottom never pops him out of it;
// letGo (0..1) eases out to the same spot, from where he falls past the collider untouched.
// Also finds the floor under him.
function placeOnPole(p, letGo = 0) {
  const col = p.collision;
  const d = p.pole.radius + T.POLE_HOLD_DIST;
  let x = p.pole.x - Math.sin(p.faceYaw) * d;
  let z = p.pole.z - Math.cos(p.faceYaw) * d;
  let floor = col.findFloor(x, p.poleY + 10, z);
  const foot = floor.surface ? smoothstep(0, 1, 1 - (p.poleY - floor.y) / T.POLE_FOOT_BLEND) : 0;
  const b = Math.max(foot, letGo);
  if (b > 0) {
    const clear = floor.surface ? clearSpot(p, x, floor.y, z) : clearSpot(p, x, p.poleY, z, true);
    x = lerp(x, clear.x, b);
    z = lerp(z, clear.z, b);
    floor = col.findFloor(x, p.poleY + 10, z);
  }
  p.pos.x = x;
  p.pos.y = p.poleY;
  p.pos.z = z;
  p.floor = floor;
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

// Grabbing the star in mid-air: drop straight down (no control, no fall damage: the group
// resets the fall peak), then celebrate on touchdown. Landing in water just swims.
const starFall = {
  group: 'automatic',
  anim: 'fall',
  enter(p) {
    setForwardVel(p, 0);
    p.vel.y = Math.min(p.vel.y, T.STAR_GRAB_MAX_VY);
  },
  update(p) {
    if (airStep(p).result === STEP_LANDED) {
      p.vel.y = 0;
      p.emit('land', { terrain: p.floor.surface?.terrain ?? 'grass', pos: { ...p.pos }, hard: false });
      p.setAction('star_dance');
      return false;
    }
    applyGravity(p);
    return false;
  },
};

// The celebration pose, standing (collectStar drops an airborne hero first: star_fall).
const starDance = {
  group: 'automatic',
  anim: 'star_dance',
  enter(p) {
    stop(p);
  },
  update(p) {
    settle(p);
    if (p.actionTimer >= T.STAR_DANCE_TICKS) p.setAction(p.grounded ? 'idle' : 'freefall');
    return false;
  },
};

export const AUTOMATIC_ACTIONS = {
  ledge_hang: ledgeHang,
  ledge_climb: ledgeClimb,
  pole,
  pole_top: poleTopAction,
  death,
  star_fall: starFall,
  star_dance: starDance,
};
