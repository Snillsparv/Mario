// Moving ground actions: running, stopping, skids, crouch slide / crawl, slope and belly
// slides, and the landing recovery that opens the double / triple jump window.

import * as T from '../physics/tuning.js';
import { groundStep, STEP_HIT_WALL, STEP_LEFT_GROUND } from '../physics/step.js';
import { decelerate, setForwardVel, stickHeldBack, updateSliding, updateWalkingSpeed } from '../physics/movement.js';
import { alignToFloor, isSteep, skidDecel, slopeAlong } from '../physics/slopes.js';
import { advanceCycle, facingWall, fallOff, jumpFromGround, walkAnim } from './common.js';

// Z while slowing down or landing: crouch slide when moving fast enough, otherwise crouch.
// (Z while walking always crouch-slides; a slow slide just stops into the crouch.)
function crouchOrSlide(p) {
  return p.setAction(p.forwardVel >= T.CROUCH_SLIDE_MIN_SPEED ? 'crouch_slide' : 'crouch');
}

// A ground step stopped by a floor edge or a wall roughly ahead.
function blockedAhead(p, r) {
  return r.result === STEP_HIT_WALL && (!r.wall || facingWall(p, r.wall, 0.5));
}

// Slides integrate p.slideVel; seed it from the velocity we arrived with.
function startSlide(p) {
  p.slideVel.x = p.vel.x;
  p.slideVel.z = p.vel.z;
}

// Standard walk-cycle anim. The cycle follows the distance travelled, but while the speed
// is still catching up with the stick the legs already pump at the stick's pace.
function animateWalk(p) {
  const anim = walkAnim(p);
  p.setAnim(anim);
  advanceCycle(p, anim, Math.max(p.intendedMag, Math.abs(p.forwardVel)));
}

// Starting to walk snaps up to the stick's speed (at most WALK_START_SPEED), except on very
// slippery floors; the walking update then eases it the rest of the way.
function startWalking(p, fv = p.forwardVel) {
  const start = p.floor.surface?.surface === 'very_slippery' ? 0 : Math.min(p.intendedMag, T.WALK_START_SPEED);
  setForwardVel(p, Math.max(fv, start));
}

const walking = {
  group: 'moving',
  enter: (p) => startWalking(p),
  update(p, c) {
    if (isSteep(p.floor) && (slopeAlong(p.floor, p.faceYaw) > 0 || p.forwardVel <= -1)) return p.setAction('butt_slide');
    if (c.A.pressed) return jumpFromGround(p);
    if (c.B.pressed) {
      const dive = p.forwardVel >= T.GROUND_DIVE_MIN_SPEED && p.stickMag > 0.8;
      return dive ? p.setAction('dive', { fromGround: true }) : p.setAction('punch');
    }
    if (c.Z.pressed) return p.setAction('crouch_slide');
    if (!p.stickHeld) return p.setAction(p.forwardVel >= T.SKID_MIN_SPEED ? 'braking' : 'decelerating');
    if (stickHeldBack(p) && p.forwardVel >= T.SKID_MIN_SPEED) return p.setAction('turnaround');

    updateWalkingSpeed(p);
    const r = groundStep(p);
    if (r.result === STEP_LEFT_GROUND) return fallOff(p);
    // Running into a wall (within 60 deg of head-on) or a floor edge stops you; near
    // head-on shows a push. Grazing walls just slide you along.
    if (blockedAhead(p, r)) {
      setForwardVel(p, Math.min(p.forwardVel, T.WALL_PUSH_SPEED));
      if (!r.wall || facingWall(p, r.wall, 0.85)) {
        p.setAnim('push');
        return false;
      }
    }
    animateWalk(p);
    return false;
  },
};

// Stick released at low speed: slow to a stop with the walk cycle winding down.
const decelerating = {
  group: 'moving',
  update(p, c) {
    if (isSteep(p.floor)) return p.setAction('butt_slide');
    if (c.A.pressed) return jumpFromGround(p);
    if (c.B.pressed) return p.setAction('punch');
    if (c.Z.pressed) return crouchOrSlide(p);
    if (p.stickHeld) return p.setAction('walking');
    decelerate(p, T.STOP_DECEL);
    const r = groundStep(p);
    if (r.result === STEP_LEFT_GROUND) return fallOff(p);
    if (blockedAhead(p, r)) setForwardVel(p, 0);
    if (p.forwardVel <= 0) return p.setAction('idle');
    animateWalk(p);
    return false;
  },
};

// Stick released at speed: a short skid.
const braking = {
  group: 'moving',
  anim: 'skid',
  enter(p) {
    p.sfx('skid');
  },
  update(p, c) {
    if (c.A.pressed) return jumpFromGround(p);
    if (c.B.pressed) return p.setAction('punch');
    if (c.Z.pressed) return crouchOrSlide(p);
    if (p.stickHeld && !stickHeldBack(p) && p.actionTimer >= 2) return p.setAction('walking');
    decelerate(p, skidDecel(p.floor));
    const r = groundStep(p);
    if (r.result === STEP_LEFT_GROUND) return fallOff(p);
    if (blockedAhead(p, r)) setForwardVel(p, 0);
    if (p.forwardVel <= 0) p.setAction('idle');
    return false;
  },
};

// Stick reversed at speed: skid to a stop, then pivot and run off the other way. A = side flip.
const turnaround = {
  group: 'moving',
  anim: 'turnaround',
  enter(p) {
    p.sfx('skid');
  },
  update(p, c) {
    if (c.A.pressed) return p.setAction('sideflip');
    if (!p.stickHeld) return p.setAction('braking');
    if (!stickHeldBack(p)) return p.setAction('walking');
    decelerate(p, skidDecel(p.floor));
    const r = groundStep(p);
    if (r.result === STEP_LEFT_GROUND) return fallOff(p);
    if (p.forwardVel <= 0 || blockedAhead(p, r)) p.setAction('finish_turnaround');
    return false;
  },
};

// The pivot after a turnaround skid: faces the new direction and starts running; A in
// these first ticks still side-flips.
const finishTurnaround = {
  group: 'moving',
  anim: 'turnaround',
  enter(p) {
    p.faceYaw = p.intendedYaw;
    startWalking(p, 0);
  },
  update(p, c) {
    if (c.A.pressed) return p.setAction('sideflip', { yaw: p.faceYaw });
    if (p.actionTimer >= T.TURNAROUND_FINISH_TICKS) return p.setAction(p.stickHeld ? 'walking' : 'idle');
    updateWalkingSpeed(p);
    if (groundStep(p).result === STEP_LEFT_GROUND) return fallOff(p);
    return false;
  },
};

const CROUCH_SLIDE = { loss: 0.95, flatDecel: 0.3, stopSpeed: 4 };
const BUTT_SLIDE = { flatDecel: 1, stopSpeed: 6 };
const BELLY_SLIDE = { loss: 0.94, flatDecel: 0.6, stopSpeed: 4 };

// Shared slide tick: returns 'left' | 'stopped' | null.
function slideStep(p, params, align) {
  const stopped = updateSliding(p, params);
  const r = groundStep(p);
  if (r.result === STEP_LEFT_GROUND) return 'left';
  if (r.wall && facingWall(p, r.wall, 0.5)) {
    // Bleed the speed going into the wall so slides don't grind against it forever.
    const into = -(p.slideVel.x * r.wall.hn.x + p.slideVel.z * r.wall.hn.z);
    if (into > 0) {
      p.slideVel.x += r.wall.hn.x * into;
      p.slideVel.z += r.wall.hn.z * into;
      p.forwardVel = Math.hypot(p.slideVel.x, p.slideVel.z);
    }
  }
  if (align) alignToFloor(p.floor, p.faceYaw, p);
  return stopped ? 'stopped' : null;
}

// Z while running: decelerating slide; A early in it is a long jump.
const crouchSlide = {
  group: 'moving',
  anim: 'crouch_slide',
  enter: startSlide,
  update(p, c) {
    if (c.A.pressed) {
      const longJump = p.actionTimer < T.LONG_JUMP_WINDOW && p.forwardVel > T.CROUCH_SLIDE_MIN_SPEED;
      return p.setAction(longJump ? 'long_jump' : 'jump');
    }
    const s = slideStep(p, CROUCH_SLIDE, false);
    if (s === 'left') return fallOff(p);
    if (s === 'stopped') p.setAction(c.Z.down ? 'crouch' : 'idle');
    return false;
  },
};

const crawl = {
  group: 'moving',
  anim: 'crawl',
  update(p, c) {
    if (!c.Z.down) return p.setAction(p.stickHeld ? 'walking' : 'idle');
    if (!p.stickHeld) return p.setAction('crouch');
    if (c.A.pressed) return p.setAction('jump');
    if (isSteep(p.floor)) return p.setAction('butt_slide');
    updateWalkingSpeed(p, p.intendedMag * T.CRAWL_SPEED_FACTOR);
    const r = groundStep(p);
    if (r.result === STEP_LEFT_GROUND) return fallOff(p);
    if (blockedAhead(p, r)) setForwardVel(p, 0);
    advanceCycle(p, 'crawl');
    return false;
  },
};

// Sliding down a slope on the backside (steep floors, or slippery ones).
const buttSlide = {
  group: 'moving',
  anim: 'butt_slide',
  enter: startSlide,
  update(p, c) {
    if (c.A.pressed) return p.setAction('jump');
    const s = slideStep(p, BUTT_SLIDE, true);
    if (s === 'left') return fallOff(p);
    if (s === 'stopped') p.setAction('land', { ticks: 8 });
    return false;
  },
};

// Landing from a dive: slide on the belly; A or B rolls back up to the feet (on a floor too
// steep for that, A jumps off it as from a butt slide).
const bellySlide = {
  group: 'moving',
  anim: 'belly_slide',
  enter: startSlide,
  update(p, c) {
    if (p.actionTimer >= 2) {
      if (isSteep(p.floor)) {
        if (c.A.pressed) return p.setAction('jump');
      } else if (c.A.pressed || c.B.pressed) {
        return p.setAction('forward_rollout');
      }
    }
    const s = slideStep(p, BELLY_SLIDE, true);
    if (s === 'left') return fallOff(p);
    if (s === 'stopped') p.setAction('land', { ticks: 8 });
    return false;
  },
};

// Landing recovery. Keeps running momentum when the stick is held; A chains jumps.
const land = {
  group: 'moving',
  anim: 'land',
  enter(p, arg) {
    p.landTicks = arg?.ticks ?? T.LAND_TICKS;
    p.landHard = !!arg?.hard;
  },
  update(p, c) {
    if (c.A.pressed && !p.landHard) return jumpFromGround(p);
    if (c.B.pressed) return p.setAction('punch');
    if (c.Z.pressed) return crouchOrSlide(p);
    if (isSteep(p.floor)) return p.setAction('butt_slide');
    if (p.stickHeld && !p.landHard) updateWalkingSpeed(p);
    else decelerate(p, skidDecel(p.floor));
    const r = groundStep(p);
    if (r.result === STEP_LEFT_GROUND) return fallOff(p);
    if (blockedAhead(p, r)) setForwardVel(p, Math.min(p.forwardVel, T.WALL_PUSH_SPEED));
    if (p.actionTimer + 1 >= p.landTicks) {
      if (p.stickHeld) p.setAction('walking');
      else p.setAction(p.forwardVel > 0 ? 'decelerating' : 'idle');
    }
    return false;
  },
};

export const MOVING_ACTIONS = {
  walking,
  decelerating,
  braking,
  turnaround,
  finish_turnaround: finishTurnaround,
  crouch_slide: crouchSlide,
  crawl,
  butt_slide: buttSlide,
  belly_slide: bellySlide,
  land,
};
