// Grabbing Rustmaw's tail (AI RACE mode, objects/RobotBeast.js; docs/ARCHITECTURE.md "AI RACE
// mode"): B next to the glowing tow coupling on the tip of its tail grabs it, circles of the
// stick spin Pip round and haul the beast off the roof into a whirl around him, B throws it.
//
// The beast publishes its grip record as `player.tailGrip` (objects set it; null: no beast):
//   { active,                    it can be grabbed now (lying on the roof)
//     x, y, z,                   the coupling's crossbar (world)
//     standX, standY, standZ,    where Pip stands to hold it...
//     standYaw,                  ...and which way he faces
//     held,                      the beast knows it is held (one of the actions below)
//     lead, yaw,                 while it is hauled up it leads Pip's facing (face `yaw`)
//     whirling }                 up in the whirl: Pip's facing is the whirl's angle
// and reads back the action, `faceYaw`, `tailSpeed` (rad/tick), `tailDir` (+1 / -1: the way
// the facing turns) and, on the tick of a throw, `tailRelease` (the spin it was let go at;
// the beast decides whether that was enough, and knocks him back itself if not).
//
// Actions (group 'automatic': they place Pip themselves, on the roof, no fall damage):
//   tail_hold   (anim 'tail_hold')  gripping the bar with both hands, heels dug in. Stick
//               circles build the spin; from TAIL_SPIN_START on -> tail_spin. B: a throw with
//               no spin (the beast twists free). Z lets go. TAIL_HOLD_TICKS without spinning
//               (or the beast gone): it tears the tail out of his hands (a stumble, no damage).
//   tail_spin   (anim 'tail_spin')  spinning on the spot: each full circle of the stick speeds
//               the spin up (TAIL_SPIN_GAIN per radian of stick turn, up to TAIL_SPIN_MAX), and
//               it winds down (TAIL_SPIN_DECAY per tick) while the stick does not turn. The first
//               TAIL_RAISE_TICKS the beast is hauled up off the roof and leads the facing; then
//               the facing turns by tailSpeed each tick. B throws (tail_throw); a spin that runs
//               down below TAIL_SPIN_OUT lets go on its own (a weak throw).
//   tail_throw  (anim 'tail_throw') the release and follow-through (TAIL_THROW_TICKS), then
//               idle. (A weak throw: the beast calls takeDamage, a 1-wedge knockback.)
// Pip never moves while holding on: his own spin cannot fling him off the roof.

import * as T from '../physics/tuning.js';
import { approachAngle, wrapAngle } from '../../core/math.js';
import { setForwardVel } from '../physics/movement.js';

// Where his hands hold the crossbar, in his body space (the model's arms reach there, the beast
// hangs its coupling there): low in front of him while it lies on the roof, up along the tail
// once it is hauled up (the hands rise over TAIL_RAISE_TICKS of tail_spin).
export const TAIL_HANDS = {
  HOLD_AHEAD: 34,
  HOLD_UP: 92,
  SPIN_AHEAD: 22,
  SPIN_UP: 116,
  HALF_WIDTH: 20, // each mitten this far to the side of the bar's centre
};

// Standing (or walking) actions a grab can start from.
const GRAB_FROM = new Set(['idle', 'sleep', 'crouch', 'punch', 'walking', 'decelerating', 'braking', 'turnaround', 'finish_turnaround', 'land']);

function stop(p) {
  setForwardVel(p, 0);
  p.vel.x = p.vel.y = p.vel.z = 0;
}

// B pressed: grabs the coupling if it is in reach (Pip on the ground within TAIL_GRAB_REACH of
// the spot to hold it from, at its height). Returns true when the grab started.
export function tryGrabTail(p) {
  const g = p.tailGrip;
  if (!g || !g.active || !p.grounded || !GRAB_FROM.has(p.action)) return false;
  const dx = g.standX - p.pos.x;
  const dz = g.standZ - p.pos.z;
  if (dx * dx + dz * dz > T.TAIL_GRAB_REACH * T.TAIL_GRAB_REACH) return false;
  if (Math.abs(g.standY - p.pos.y) > T.TAIL_GRAB_REACH_Y) return false;
  p.setAction('tail_hold');
  return true;
}

// The spin a tick of stick circling adds (rad/tick; 0 when the stick is not turning the spin's
// way). The stick's angle is tracked while it is pushed at least TAIL_STICK_MIN; steps larger
// than TAIL_STICK_STEP_MAX (flicked across the middle) do not count. The first TAIL_DIR_TURN of
// turning picks the direction: the facing then turns the way the stick's world direction does.
function stickTurn(p) {
  const c = p.input;
  const rx = p.rawStickX;
  const ry = p.rawStickY;
  if (rx * rx + ry * ry < T.TAIL_STICK_MIN * T.TAIL_STICK_MIN) {
    p.tailStickValid = false;
    return 0;
  }
  const a = Math.atan2(c.stickX, c.stickY);
  if (!p.tailStickValid) {
    p.tailStickValid = true;
    p.tailStickAngle = a;
    return 0;
  }
  const d = wrapAngle(a - p.tailStickAngle);
  p.tailStickAngle = a;
  if (d > T.TAIL_STICK_STEP_MAX || d < -T.TAIL_STICK_STEP_MAX) return 0;
  if (p.tailDir === 0) {
    p.tailTurn += d;
    // The stick's world direction is cameraYaw - angle: it turns against the stick's angle.
    if (p.tailTurn >= T.TAIL_DIR_TURN) p.tailDir = -1;
    else if (p.tailTurn <= -T.TAIL_DIR_TURN) p.tailDir = 1;
    return 0;
  }
  const turn = -d * p.tailDir;
  return turn > 0 ? turn : 0;
}

// Updates p.tailSpeed from the stick for one tick; returns whether the stick turned it on.
function spinUp(p) {
  const turn = stickTurn(p);
  if (turn > 0) {
    p.tailSpeed += turn * T.TAIL_SPIN_GAIN;
    if (p.tailSpeed > T.TAIL_SPIN_MAX) p.tailSpeed = T.TAIL_SPIN_MAX;
    return true;
  }
  p.tailSpeed -= T.TAIL_SPIN_DECAY;
  if (p.tailSpeed < 0) p.tailSpeed = 0;
  return false;
}

// Keeps him where he holds on (on the floor there, at rest).
function hold(p) {
  stop(p);
  p.grounded = true;
  if (p.tailFloorTicks++ % 15 === 0) p.floor = p.collision.findFloor(p.pos.x, p.pos.y + 10, p.pos.z);
}

// Let go without a throw: a stumble back from the tail as it tears loose (no damage).
function tornLoose(p) {
  p.tailSpeed = 0;
  p.setAction('hurt', { yaw: p.faceYaw });
  return false;
}

const tailHold = {
  group: 'automatic',
  anim: 'tail_hold',
  enter(p) {
    stop(p);
    const g = p.tailGrip;
    p.tailFrom = p.tailFrom ?? { x: 0, z: 0 };
    p.tailFrom.x = p.pos.x;
    p.tailFrom.z = p.pos.z;
    p.tailSpeed = 0;
    p.tailDir = 0;
    p.tailTurn = 0;
    p.tailStickValid = false;
    p.tailStickAngle = 0;
    p.tailRelease = -1;
    p.tailIdle = 0;
    p.tailFloorTicks = 0;
    p.headYaw = 0;
    if (g) p.floor = p.collision.findFloor(g.standX, g.standY + 10, g.standZ);
    p.sfx('ledge_grab');
  },
  update(p, c) {
    const g = p.tailGrip;
    if (!g || !(g.active || g.held)) return tornLoose(p);
    // Step over to the spot to hold it from (a few ticks), facing the coupling.
    const k = p.actionTimer >= T.TAIL_STEP_TICKS ? 1 : (p.actionTimer + 1) / T.TAIL_STEP_TICKS;
    p.pos.x = p.tailFrom.x + (g.standX - p.tailFrom.x) * k;
    p.pos.z = p.tailFrom.z + (g.standZ - p.tailFrom.z) * k;
    p.pos.y = g.standY;
    p.faceYaw = approachAngle(p.faceYaw, g.standYaw, 0.35);
    hold(p);
    if (p.actionTimer < 2) return false;
    if (c.Z.pressed) {
      // Let go (the same press does not also crouch).
      p.tailSpeed = 0;
      p.pressGuard = true;
      p.setAction('idle');
      return false;
    }
    if (c.B.pressed) return p.setAction('tail_throw');
    if (spinUp(p)) p.tailIdle = 0;
    else if (++p.tailIdle >= T.TAIL_HOLD_TICKS) return tornLoose(p);
    if (p.tailSpeed >= T.TAIL_SPIN_START && p.tailDir !== 0) return p.setAction('tail_spin');
    return false;
  },
};

const tailSpin = {
  group: 'automatic',
  anim: 'tail_spin',
  enter(p) {
    stop(p);
    p.tailFloorTicks = 0;
  },
  update(p, c) {
    const g = p.tailGrip;
    if (!g || !g.held) {
      // The beast is gone (the mode ended, a reset): nothing left to hold.
      if (p.actionTimer > 2) return tornLoose(p);
    }
    hold(p);
    spinUp(p);
    if (g && g.lead) p.faceYaw = approachAngle(p.faceYaw, g.yaw, 0.25);
    else if (g && g.whirling) p.faceYaw = wrapAngle(p.faceYaw + p.tailDir * p.tailSpeed);
    if (c.B.pressed && p.actionTimer >= 2) return p.setAction('tail_throw');
    // Ran down after the haul: the grip slips (a throw with too little spin).
    if (p.actionTimer > T.TAIL_RAISE_TICKS && p.tailSpeed < T.TAIL_SPIN_OUT) return p.setAction('tail_throw');
    return false;
  },
};

const tailThrow = {
  group: 'automatic',
  anim: 'tail_throw',
  enter(p) {
    stop(p);
    p.tailRelease = p.tailSpeed;
    p.tailFloorTicks = 0;
  },
  update(p) {
    hold(p);
    // Follow-through: the spin carries on a little, dying out.
    p.tailSpeed *= 0.7;
    if (p.tailDir !== 0) p.faceYaw = wrapAngle(p.faceYaw + p.tailDir * p.tailSpeed);
    if (p.actionTimer >= 1) p.tailRelease = -1; // read by the beast on the tick it was let go
    if (p.actionTimer >= T.TAIL_THROW_TICKS) {
      p.tailSpeed = 0;
      p.setAction('idle');
    }
    return false;
  },
};

export const TAIL_ACTIONS = {
  tail_hold: tailHold,
  tail_spin: tailSpin,
  tail_throw: tailThrow,
};
