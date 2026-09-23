// Stationary ground actions: standing, sleeping, crouching, punching and the short
// recovery poses after hard landings, knockbacks and ground pounds.

import * as T from '../physics/tuning.js';
import { groundStep, STEP_LEFT_GROUND } from '../physics/step.js';
import { decelerate, setForwardVel } from '../physics/movement.js';
import { isSteep } from '../physics/slopes.js';
import { fallOff, jumpFromGround } from './common.js';

// Standing in place: re-snaps to the floor and falls if it disappears.
function standStill(p) {
  setForwardVel(p, 0);
  return groundStep(p).result === STEP_LEFT_GROUND ? fallOff(p) : false;
}

// A fixed-length pose that returns to idle.
function recovery(anim, ticks, { friction = 2 } = {}) {
  return {
    group: 'stationary',
    anim,
    update(p) {
      decelerate(p, friction);
      if (groundStep(p).result === STEP_LEFT_GROUND) return fallOff(p);
      if (p.actionTimer >= ticks) p.setAction('idle');
      return false;
    },
  };
}

const idle = {
  group: 'stationary',
  anim: 'idle',
  update(p, c) {
    if (isSteep(p.floor)) return p.setAction('butt_slide');
    if (c.A.pressed) return jumpFromGround(p);
    if (c.B.pressed) return p.setAction('punch');
    if (c.Z.down) return p.setAction('crouch');
    if (p.stickHeld) {
      p.faceYaw = p.intendedYaw;
      return p.setAction('walking');
    }
    const t = p.actionTimer - T.IDLE_LOOK_TICKS;
    if (t > 0) p.headYaw = 0.7 * Math.sin(t * 0.045) * Math.min(1, t / 20);
    if (p.actionTimer >= T.IDLE_SLEEP_TICKS) return p.setAction('sleep');
    return standStill(p);
  },
};

const sleep = {
  group: 'stationary',
  anim: 'sleep',
  update(p, c) {
    const woken = p.stickHeld || c.A.pressed || c.B.pressed || c.Z.pressed;
    if (woken) return p.setAction('idle');
    return standStill(p);
  },
};

const crouch = {
  group: 'stationary',
  anim: 'crouch',
  update(p, c) {
    if (isSteep(p.floor)) return p.setAction('butt_slide');
    if (c.A.pressed) return p.setAction('backflip');
    if (!c.Z.down) return p.setAction('idle');
    if (p.stickHeld) return p.setAction('crawl');
    return standStill(p);
  },
};

// Punch, punch, kick combo: B during a hit queues the next one.
const PUNCH_STEPS = [
  { anim: 'punch1', ticks: 7, sfx: 'punch' },
  { anim: 'punch2', ticks: 7, sfx: 'punch' },
  { anim: 'kick', ticks: 10, sfx: 'kick' },
];

const punch = {
  group: 'stationary',
  enter(p) {
    p.punchStep = 0;
    p.punchQueued = false;
    p.punchStart = 0;
    p.setAnim('punch1', true);
    p.sfx('punch');
  },
  update(p, c) {
    if (c.A.pressed) return jumpFromGround(p);
    const elapsed = p.actionTimer - p.punchStart;
    if (c.B.pressed && elapsed >= 2) p.punchQueued = true;
    if (elapsed >= PUNCH_STEPS[p.punchStep].ticks) {
      if (!p.punchQueued || p.punchStep === 2) return p.setAction(p.stickHeld ? 'walking' : 'idle');
      p.punchStep++;
      p.punchQueued = false;
      p.punchStart = p.actionTimer;
      const step = PUNCH_STEPS[p.punchStep];
      p.setAnim(step.anim, true);
      p.sfx(step.sfx);
    }
    decelerate(p, 1.5);
    return groundStep(p).result === STEP_LEFT_GROUND ? fallOff(p) : false;
  },
};

// Knocked-back landing, fall damage stagger, intro landing pose, ground-pound impact.
const hurtGround = recovery('hurt', 20, { friction: 1.5 });
const hardFall = recovery('fall_damage', 30);
const spawnLand = recovery('land', 20);
const groundPoundLand = recovery('ground_pound_land', T.POUND_LAND_TICKS);

export const STATIONARY_ACTIONS = {
  idle,
  sleep,
  crouch,
  punch,
  hurt_ground: hurtGround,
  hard_fall: hardFall,
  spawn_land: spawnLand,
  ground_pound_land: groundPoundLand,
};
