// Airborne actions: the jump family, falls, dives and kicks, ground pound, wall kicks and
// bonks, knockback and the intro drop. Most share airTick() configured per action.

import { approachAngle, clamp, wrapAngle } from '../../core/math.js';
import * as T from '../physics/tuning.js';
import { airStep, STEP_LANDED } from '../physics/step.js';
import { applyGravity, setForwardVel, updateAirControl } from '../physics/movement.js';
import { facingWall, landFromAir, poleInReach, tryLedgeGrab, tryPoleGrab } from './common.js';

// Leaves the ground with the given vertical and forward speed.
function takeOff(p, vy, fv) {
  p.vel.y = vy;
  p.grounded = false;
  setForwardVel(p, fv);
}

// Knockback-style motion: velocity follows forward speed only, no stick influence.
function keepMomentum(p) {
  p.vel.x = p.forwardVel * Math.sin(p.faceYaw);
  p.vel.z = p.forwardVel * Math.cos(p.faceYaw);
}

function canWallKick(p) {
  return p.wall && p.tick - p.wallTouchTick <= T.WALL_KICK_WINDOW;
}

// A head-on wall contact too slow to bonk: the forward speed is spent against the wall (so
// steering can't build it up while pressed there) and the hero slides down it.
function stopAgainstWall(p, wall) {
  p.forwardVel = 0;
  const into = -(p.vel.x * wall.hn.x + p.vel.z * wall.hn.z);
  if (into > 0) {
    p.vel.x += wall.hn.x * into;
    p.vel.z += wall.hn.z * into;
  }
}

// Leaping out of the water against a bank or moat wall never bonks: the leap carries on up
// (or down) the face with a little forward speed kept, so that once the feet clear the rim
// Pip moves onto it (and air control can't build speed up while he is pressed there).
function slideAlongWall(p, wall) {
  p.forwardVel = Math.min(p.forwardVel, T.WATER_JUMP_WALL_FV);
  const into = -(p.vel.x * wall.hn.x + p.vel.z * wall.hn.z);
  if (into > 0) {
    p.vel.x += wall.hn.x * into;
    p.vel.z += wall.hn.z * into;
  }
}

/*
 * One air tick. Options:
 *   anim (static), land (landFromAir opts), maxSpeed, gravity, terminal (fall speed limit),
 *   controlHeight (A release cuts rise), control (stick steering, default true),
 *   kick (B = dive / jump kick), pound (Z; never on the tick the action began, so a Z pressed
 *   with the take-off's A is no ground pound), lateLongJump (Z within LONG_JUMP_COMBO_TICKS of
 *   a fast take-off long-jumps instead, see rememberTakeOff), ledge / pole (grabs), wallHit
 *   (action entered on a head-on wall hit at speed), wallSlide (head-on walls are slid along
 *   at a capped speed instead: never a bonk), coastRising (while rising, a stick held back
 *   doesn't brake), wallKick (A may still wall kick shortly after touching a wall), pitch(p)
 *   (body pitch).
 */
function airTick(p, c, o) {
  if (o.lateLongJump && c.Z.pressed && p.comboJump && p.actionTimer <= T.LONG_JUMP_COMBO_TICKS) {
    return p.setAction('long_jump', p.comboJump);
  }
  if (o.pound && c.Z.pressed && p.actionTimer > 0) return p.setAction('ground_pound');
  if (o.kick && c.B.pressed) return p.setAction(p.forwardVel >= T.AIR_DIVE_MIN_SPEED ? 'dive' : 'jump_kick');
  if (o.wallKick && c.A.pressed && canWallKick(p)) return p.setAction('wallkick');
  if (o.control === false) keepMomentum(p);
  else updateAirControl(p, o.maxSpeed, o.coastRising && p.vel.y > 0);

  const r = airStep(p);
  if (r.result === STEP_LANDED) return landFromAir(p, o.land);
  if (o.ledge && r.wall && tryLedgeGrab(p, r.wall)) return false;
  // A trunk in reach is grabbed; its collider walls never bonk (they are slid around).
  const trunk = poleInReach(p, r.wall);
  if (trunk !== p.letGoPole) p.letGoPole = null; // out of its reach: grabbable again
  if (o.pole && trunk && tryPoleGrab(p, trunk)) return false;
  const w = r.wall;
  if (w && !w.pole && facingWall(p, w, T.WALL_HEAD_ON_COS)) {
    if (o.wallSlide) slideAlongWall(p, w);
    else if (o.wallHit && !trunk && p.forwardVel >= T.WALL_KICK_MIN_SPEED) {
      p.wall = w;
      p.setAction(o.wallHit);
      return false;
    } else {
      stopAgainstWall(p, w);
    }
  }
  applyGravity(p, o.controlHeight && !p.stompBounce, o.gravity, o.terminal);
  o.pitch?.(p);
  return false;
}

// Builds an airborne action from an enter() and airTick options.
function airAction(enter, opts) {
  return {
    group: 'airborne',
    anim: opts.anim,
    enter,
    update: (p, c) => airTick(p, c, opts),
  };
}

// The options most jumps share.
const JUMPY = { kick: true, pound: true, ledge: true, pole: true, wallHit: 'air_hit_wall' };

// A jump taking off from a run at LONG_JUMP_COMBO_SPEED or more remembers its take-off
// ({ fv, y }): a Z press in its first LONG_JUMP_COMBO_TICKS turns it into a long jump (A then
// Z, the keyboard's either-order long jump; see long_jump).
function rememberTakeOff(p) {
  p.comboJump = p.forwardVel >= T.LONG_JUMP_COMBO_SPEED ? { fv: p.forwardVel, y: p.pos.y } : null;
}

// arg.bounce (player.bounce: stomped on an enemy): rises at that speed keeping the forward
// speed and drift, with no jump cut on releasing A (p.stompBounce, cleared on the next action).
// Like a landing, the stomp ends the fall: fall damage counts from the bounce's own peak.
const jump = airAction(
  (p, arg) => {
    if (arg?.bounce) {
      p.comboJump = null;
      p.vel.y = arg.bounce;
      p.grounded = false;
      p.stompBounce = true;
      p.peakY = p.pos.y;
      p.fallCeiling = Infinity;
      p.sfx('stomp');
      return;
    }
    rememberTakeOff(p);
    takeOff(p, T.JUMP_VY + p.forwardVel * T.JUMP_FV_SCALE, p.forwardVel * T.JUMP_KEEP_FV);
    p.sfx('jump');
  },
  { ...JUMPY, lateLongJump: true, anim: 'jump', controlHeight: true, land: { chain: 'single' } },
);

const doubleJump = airAction(
  (p) => {
    rememberTakeOff(p);
    takeOff(p, T.DOUBLE_JUMP_VY + p.forwardVel * T.JUMP_FV_SCALE, p.forwardVel * T.JUMP_KEEP_FV);
    p.sfx('double_jump');
  },
  { ...JUMPY, lateLongJump: true, anim: 'double_jump', controlHeight: true, land: { chain: 'double' } },
);

const tripleJump = airAction(
  (p) => {
    takeOff(p, T.TRIPLE_JUMP_VY, p.forwardVel * T.JUMP_KEEP_FV);
    p.sfx('triple_jump');
  },
  { ...JUMPY, anim: 'triple_jump', land: { ticks: T.FLIP_LAND_TICKS } },
);

const backflip = airAction(
  (p) => {
    takeOff(p, T.FLIP_VY, T.BACKFLIP_FV);
    p.sfx('backflip');
  },
  { ...JUMPY, kick: false, anim: 'backflip', land: { ticks: T.FLIP_LAND_TICKS } },
);

// arg.yaw: the facing to leave with (default: the reverse of the current facing).
const sideflip = airAction(
  (p, arg) => {
    p.faceYaw = arg?.yaw ?? wrapAngle(p.faceYaw + Math.PI);
    takeOff(p, T.FLIP_VY, T.SIDEFLIP_FV);
    p.sfx('sideflip');
  },
  { ...JUMPY, anim: 'sideflip', land: { chain: 'single', ticks: T.FLIP_LAND_TICKS } },
);

// Height a long jump rises above its take-off (vy, vy - g, ... while positive: ~240).
const LONG_JUMP_RISE = (T.LONG_JUMP_VY * T.LONG_JUMP_VY) / (2 * T.LONG_JUMP_GRAVITY) + T.LONG_JUMP_VY / 2;

// arg (optional): the take-off ({ fv, y }) of the jump this long jump replaces, when Z came
// a few ticks after A (see rememberTakeOff). It carries on from where the jump is (no snap):
// the forward speed the take-off would have given, and a rise that tops out at the usual
// long-jump height above the take-off.
const longJump = airAction(
  (p, late) => {
    if (late) {
      const rise = Math.max(0, LONG_JUMP_RISE - (p.pos.y - late.y));
      const g = T.LONG_JUMP_GRAVITY;
      p.vel.y = Math.sqrt((g * g) / 4 + 2 * g * rise) - g / 2;
      setForwardVel(p, Math.min(late.fv * T.LONG_JUMP_SCALE, T.MAX_FORWARD_VEL));
    } else {
      takeOff(p, T.LONG_JUMP_VY, Math.min(p.forwardVel * T.LONG_JUMP_SCALE, T.MAX_FORWARD_VEL));
    }
    p.comboJump = null;
    p.sfx('long_jump');
  },
  {
    anim: 'long_jump',
    maxSpeed: T.MAX_FORWARD_VEL,
    gravity: T.LONG_JUMP_GRAVITY,
    terminal: T.LONG_JUMP_TERMINAL_VY,
    ledge: true,
    pole: true,
    wallHit: 'air_hit_wall',
    land: {},
  },
);

const freefall = airAction(null, { ...JUMPY, anim: 'fall', land: { chain: 'single' } });

const dive = airAction(
  (p, arg) => {
    if (arg?.fromGround) takeOff(p, T.GROUND_DIVE_VY, p.forwardVel);
    setForwardVel(p, Math.min(p.forwardVel + T.DIVE_BOOST, T.MAX_FORWARD_VEL));
    p.sfx('dive');
  },
  {
    anim: 'dive',
    maxSpeed: T.MAX_FORWARD_VEL,
    wallHit: 'bonk',
    land: { next: 'belly_slide' },
    pitch: (p) => {
      p.pitch = clamp(Math.atan2(-p.vel.y, Math.max(p.forwardVel, 10)), -0.5, 1.2);
    },
  },
);

const jumpKick = airAction(
  (p) => {
    p.sfx('jump_kick');
  },
  { anim: 'jump_kick', ledge: true, wallHit: 'air_hit_wall', land: {} },
);

// A somersault back onto the feet out of a belly slide (shown with the front-flip anim).
const forwardRollout = airAction(
  (p) => {
    takeOff(p, T.ROLLOUT_VY, p.forwardVel);
    p.sfx('jump');
  },
  { anim: 'triple_jump', pound: true, ledge: true, land: {} },
);

// Leaping out of the water (A with the stick pulled back at the surface). Keeping the stick
// back while rising doesn't brake the leap, and a bank or moat wall ahead is slid up rather
// than bonked off, so Pip carries on onto the rim once his feet clear it.
const waterJump = airAction(
  (p) => {
    takeOff(p, T.WATER_JUMP_VY, Math.max(p.forwardVel, 8));
    p.sfx('water_exit');
    p.emit('splash', { pos: { ...p.pos }, big: false });
  },
  { ...JUMPY, wallSlide: true, coastRising: true, anim: 'water_jump', land: { chain: 'single' } },
);

// Kicking off a trunk: the same leap as a wall kick, facing away from the trunk.
const poleJump = airAction(
  (p) => {
    p.faceYaw = wrapAngle(p.faceYaw + Math.PI);
    p.grabCooldownUntil = p.tick + T.GRAB_COOLDOWN;
    takeOff(p, T.FLIP_VY, Math.max(p.forwardVel, T.WALL_KICK_FV));
    p.sfx('jump');
  },
  { ...JUMPY, pole: false, anim: 'pole_jump', controlHeight: true, land: { chain: 'single' } },
);

// Springing off the handstand on a pole's tip (pole_top): a big, high flip toward the stick
// when it is held (else along the facing) with a little forward speed; steered like a jump.
// The trunk is not grabbed again until he is out of its reach, and the fall counts from the
// tree's foot (Player.afterTick), so jumping off a tree top never hurts on level ground.
const poleTopJump = airAction(
  (p) => {
    if (p.stickHeld) p.faceYaw = p.intendedYaw;
    p.grabCooldownUntil = p.tick + T.GRAB_COOLDOWN;
    p.letGoPole = p.pole;
    takeOff(p, T.POLE_TOP_JUMP_VY, T.POLE_TOP_JUMP_FV);
    p.sfx('triple_jump');
  },
  { ...JUMPY, anim: 'triple_jump', land: { ticks: T.FLIP_LAND_TICKS } },
);

// Mirrors the facing off the wall and leaps; a faster incoming speed is kept.
const wallkick = airAction(
  (p) => {
    const wallYaw = Math.atan2(p.wall.hn.x, p.wall.hn.z);
    p.faceYaw = wrapAngle(2 * wallYaw - p.faceYaw + Math.PI);
    takeOff(p, T.FLIP_VY, Math.max(p.forwardVel, T.WALL_KICK_FV));
    p.wallTouchTick = -Infinity;
    p.setAnim('wallkick', true);
    p.sfx('wallkick');
  },
  { ...JUMPY, anim: 'wallkick', controlHeight: true, land: { chain: 'single' } },
);

// Touching a wall head-on at speed: braced against it (the wall kick's first pose) for a
// moment; A = wall kick, otherwise a bonk (a hard one at high speed).
const airHitWall = {
  group: 'airborne',
  anim: 'wallkick',
  enter(p) {
    p.wallTouchTick = p.tick;
    p.vel.x = 0;
    p.vel.z = 0;
  },
  update(p, c) {
    if (c.A.pressed) return p.setAction('wallkick');
    if (p.actionTimer >= 2) return p.setAction(p.forwardVel >= T.HARD_BONK_SPEED ? 'bonk' : 'soft_bonk');
    p.holdAnimStart();
    return false;
  },
};

// Knocked slightly off the wall; falls without control (a late A still wall kicks).
const softBonk = airAction(
  (p) => {
    p.forwardVel = -8;
    p.vel.y = Math.min(p.vel.y, 0);
    p.sfx('bonk');
  },
  { anim: 'bonk', control: false, wallKick: true, land: { ticks: T.FLIP_LAND_TICKS } },
);

// Diving (or crashing fast) into a wall: bounce back hard.
const bonk = airAction(
  (p) => {
    p.forwardVel = -12;
    p.vel.y = Math.min(p.vel.y, 0);
    p.sfx('bonk');
  },
  { anim: 'bonk', control: false, land: { ticks: T.HARD_LAND_TICKS } },
);

// Damage knockback (arg.yaw faces the damage source, the hero flies backward).
const hurt = airAction(
  (p, arg) => {
    if (arg && arg.yaw !== undefined) p.faceYaw = arg.yaw;
    takeOff(p, T.KNOCKBACK_VY, T.KNOCKBACK_FV);
  },
  { anim: 'hurt', control: false, land: { next: 'hurt_ground' } },
);

// Burnt by fire (takeDamage with { fire: true }; arg.yaw: the way out of the fire): a hot-foot
// hop straight up, running in the air, turning toward the stick a little (BURN_TURN_RATE) and
// steered like a jump up to BURN_MAX_SPEED; no moves until he lands, normally.
const BURN = { anim: 'burn', maxSpeed: T.BURN_MAX_SPEED, land: {} };
const burn = {
  group: 'airborne',
  anim: 'burn',
  enter(p, arg) {
    if (arg && arg.yaw !== undefined) p.faceYaw = wrapAngle(arg.yaw);
    takeOff(p, T.BURN_VY, T.BURN_FV);
    p.sfx('burn');
  },
  update(p, c) {
    if (p.stickHeld) p.faceYaw = approachAngle(p.faceYaw, p.intendedYaw, T.BURN_TURN_RATE);
    return airTick(p, c, BURN);
  },
};

// Intro drop from the sky; input is ignored until landed.
const spawn = airAction(
  (p) => {
    takeOff(p, 0, 0);
  },
  { anim: 'spawn', control: false, land: { next: 'spawn_land', safe: true } },
);

// Z in the air: spin in place, then plummet. Never takes fall damage.
const groundPound = {
  group: 'airborne',
  anim: 'ground_pound_spin',
  enter(p) {
    setForwardVel(p, 0);
    p.vel.y = 0;
    p.sfx('ground_pound');
  },
  update(p) {
    const spinning = p.actionTimer < T.POUND_SPIN_TICKS;
    p.setAnim(spinning ? 'ground_pound_spin' : 'ground_pound_fall');
    if (spinning) p.vel.y = Math.max(0, T.POUND_HOP_VY - T.POUND_HOP_DECAY * p.actionTimer); // wind-up hop
    const r = airStep(p);
    if (r.result === STEP_LANDED) {
      p.sfx('ground_pound_land');
      return landFromAir(p, { pound: true, next: 'ground_pound_land' });
    }
    if (spinning) p.vel.y = p.actionTimer === T.POUND_SPIN_TICKS - 1 ? T.POUND_START_VY : 0;
    else p.vel.y = Math.max(p.vel.y - T.GRAVITY, T.TERMINAL_VY);
    return false;
  },
};

export const AIRBORNE_ACTIONS = {
  jump,
  double_jump: doubleJump,
  triple_jump: tripleJump,
  backflip,
  sideflip,
  long_jump: longJump,
  freefall,
  dive,
  jump_kick: jumpKick,
  forward_rollout: forwardRollout,
  water_jump: waterJump,
  pole_jump: poleJump,
  pole_top_jump: poleTopJump,
  wallkick,
  air_hit_wall: airHitWall,
  soft_bonk: softBonk,
  bonk,
  hurt,
  burn,
  spawn,
  ground_pound: groundPound,
};
