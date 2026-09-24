// Winged-hat flight (action 'flying', anim 'fly'). While player.wingHat is on, a triple jump or
// the flip jump off a tree top takes off into it (common.js jumpFromGround, automatic.js
// pole_top; arg.fromPole: the pole jumped off, not grabbed again). Tank controls with the
// raw stick, like swimming: stick up = nose down (dive, gains speed), stick down = nose up
// (climb, drains speed; the wings flap), stick left / right banks and the heading turns in
// proportion to the bank. The air speed p.flySpeed runs along the heading and pitch
// (p.flyPitch, > 0 nose down; p.flyBank, > 0 right side down), shown by RenderState.pitch /
// roll. Endings: too slow (a stall), Z, or the hat running out -> freefall; a wall ahead ->
// bonk; the ground -> a belly-slide landing (shallow) or a normal one (steep); water -> a
// dive into swimming (enterWater). Falls that start in a flight never hurt (p.flightFall).
// The edge of the world (no ground at all ahead, past the cliffs) turns the flight for home.

import { angleDiff, approach, approachAngle, clamp, wrapAngle } from '../../core/math.js';
import * as T from '../physics/tuning.js';
import { airStep, STEP_LANDED } from '../physics/step.js';
import { landFromAir } from './common.js';

// Sub-steps per tick at air speed s: each moves at most ~10 units (the classic quarter steps
// move up to ~19 at the fastest fall), so walls, floors and ceilings can't be skipped at 70.
const MAX_SUB_STEP = 10;
function subSteps(s) {
  return clamp(Math.ceil(s / MAX_SUB_STEP), 4, 8);
}

// The edge of the world: with no ground at all EDGE_LOOKAHEAD ahead the flight is turned
// toward the spawn (EDGE_TURN per tick, banking into the turn), and a step that would leave the
// ground behind altogether is undone horizontally (and turns for home at once), so Pip never
// flies out of the level. "Ground" is any floor or wall (steep hill facets are walls) straight
// below or above the spot.
const EDGE_LOOKAHEAD = 1500;
const EDGE_TURN = 0.08;
const SKY = 1e5;
const rayFrom = { x: 0, y: SKY, z: 0 };
const RAY_DOWN = { x: 0, y: -1, z: 0 };
const RAY_GROUND = { floors: true, walls: true, ceilings: false };
// The body's shown pitch / bank change at most this much per tick (smooths the take-off).
const TILT_RATE = 0.2;

function groundUnder(p, x, z) {
  if (p.collision.findFloor(x, SKY, z, 0).surface) return true;
  rayFrom.x = x;
  rayFrom.z = z;
  return p.collision.raycast(rayFrom, RAY_DOWN, 2 * SKY, RAY_GROUND) !== null;
}

// `force`: turn even when there is ground ahead (the last step was undone at the edge).
function turnForHome(p, force = false) {
  const x = p.pos.x + Math.sin(p.faceYaw) * EDGE_LOOKAHEAD;
  const z = p.pos.z + Math.cos(p.faceYaw) * EDGE_LOOKAHEAD;
  if (!force && groundUnder(p, x, z)) return;
  const home = Math.atan2(p.spawn.x - p.pos.x, p.spawn.z - p.pos.z);
  const d = angleDiff(p.faceYaw, home);
  p.faceYaw = approachAngle(p.faceYaw, home, EDGE_TURN);
  // Turning left (yaw growing) banks left (roll < 0).
  p.flyBank = approach(p.flyBank, -Math.sign(d) * T.FLY_MAX_BANK, T.FLY_BANK_RATE);
}

// Velocity from the air speed, heading and pitch.
function applyFlightVelocity(p) {
  const s = p.flySpeed;
  const cp = Math.cos(p.flyPitch);
  p.forwardVel = s * cp;
  p.airDrift = 0;
  p.vel.x = p.forwardVel * Math.sin(p.faceYaw);
  p.vel.z = p.forwardVel * Math.cos(p.faceYaw);
  p.vel.y = -s * Math.sin(p.flyPitch);
}

// Leaves the flight into another airborne action, keeping the momentum. Returns true (run
// the next action this tick) when the flight has not moved yet this tick (`moved` false).
function endFlight(p, next = 'freefall', moved = false) {
  p.flyBank = 0;
  p.setAction(next);
  return !moved;
}

// The pitch the stick asks for: neutral glides slightly nose down, full up dives, full down climbs.
function targetPitch(sy) {
  return sy >= 0 ? T.FLY_GLIDE_PITCH + sy * (T.FLY_MAX_DIVE - T.FLY_GLIDE_PITCH) : T.FLY_GLIDE_PITCH + sy * (T.FLY_MAX_CLIMB + T.FLY_GLIDE_PITCH);
}

// Touch-down from a flight: shallow -> belly slide at the flight's horizontal speed, steep ->
// on the feet. Never fall damage.
function landFromFlight(p) {
  const h = Math.hypot(p.vel.x, p.vel.z);
  const angle = Math.atan2(-p.vel.y, h);
  p.flyBank = 0;
  if (angle < T.FLY_BELLY_LAND_ANGLE && h >= T.FLY_MIN_SPEED) {
    p.forwardVel = h;
    return landFromAir(p, { next: 'belly_slide', safe: true });
  }
  p.forwardVel = Math.min(h, T.FLY_LAND_MAX_SPEED);
  p.vel.x = p.forwardVel * Math.sin(p.faceYaw);
  p.vel.z = p.forwardVel * Math.cos(p.faceYaw);
  return landFromAir(p, { safe: true });
}

// True when the wall contact is within FLY_BONK_COS of the heading (head-on enough to crash).
function headOn(p, wall) {
  return -(Math.sin(p.faceYaw) * wall.hn.x + Math.cos(p.faceYaw) * wall.hn.z) > T.FLY_BONK_COS;
}

const flying = {
  group: 'airborne',
  anim: 'fly',
  enter(p, arg) {
    const pole = arg?.fromPole;
    if (pole) {
      if (p.stickHeld) p.faceYaw = p.intendedYaw;
      p.grabCooldownUntil = p.tick + T.GRAB_COOLDOWN;
      p.letGoPole = pole;
    }
    p.flySpeed = clamp(Math.max(T.FLY_LAUNCH_SPEED, p.forwardVel), T.FLY_MIN_SPEED, T.FLY_MAX_SPEED);
    p.flyPitch = T.FLY_LAUNCH_PITCH;
    p.flyBank = 0;
    p.flapTimer = 0;
    p.grounded = false;
    p.comboJump = null;
    applyFlightVelocity(p);
    p.sfx('triple_jump');
  },
  update(p, c) {
    if (p.wingHat <= 0 || c.Z.pressed) return endFlight(p);

    // Steering: the take-off holds its climb for FLY_LAUNCH_TICKS unless the stick dives.
    const sy = p.rawStickY;
    const launching = p.actionTimer < T.FLY_LAUNCH_TICKS;
    const want = launching && sy <= 0 ? T.FLY_LAUNCH_PITCH : targetPitch(sy);
    p.flyPitch = approach(p.flyPitch, want, T.FLY_PITCH_RATE);
    p.flyBank = approach(p.flyBank, p.rawStickX * T.FLY_MAX_BANK, T.FLY_BANK_RATE);
    p.faceYaw = wrapAngle(p.faceYaw - p.flyBank * T.FLY_TURN_PER_BANK);
    turnForHome(p);

    // Speed: diving gains, climbing drains (not during the take-off), drag settles the glide.
    const sinP = Math.sin(p.flyPitch);
    let s = p.flySpeed;
    if (sinP >= 0) s += T.FLY_DIVE_ACCEL * sinP;
    else if (!launching) s += T.FLY_CLIMB_DRAIN * sinP;
    s -= s * T.FLY_DRAG;
    p.flySpeed = Math.min(s, T.FLY_MAX_SPEED);
    if (p.flySpeed < T.FLY_STALL_SPEED) return endFlight(p);

    // Wing flaps while climbing (not while gliding or diving).
    if (p.flapTimer > 0) p.flapTimer--;
    if (p.flyPitch < T.FLY_FLAP_PITCH && p.flapTimer <= 0) {
      p.sfx('wing_flap');
      p.flapTimer = T.FLY_FLAP_TICKS;
    }

    applyFlightVelocity(p);
    const x0 = p.pos.x;
    const z0 = p.pos.z;
    const r = airStep(p, subSteps(p.flySpeed));
    if (r.result === STEP_LANDED) return landFromFlight(p);
    if (!p.floor.surface && !groundUnder(p, p.pos.x, p.pos.z)) {
      p.pos.x = x0;
      p.pos.z = z0;
      p.floor = p.collision.findFloor(x0, p.pos.y, z0);
      turnForHome(p, true);
    }
    // A wall ahead, or no room at the spot ahead (a low ceiling over it): crash.
    const w = r.wall;
    if (r.blocked || (w && headOn(p, w))) return endFlight(p, 'bonk', true);
    if (w) p.flySpeed *= 0.98; // grazing: slide along it
    if (r.hitCeiling && p.flyPitch < 0) {
      p.flyPitch = 0;
      p.flySpeed *= 0.9;
    }
    p.pitch = approach(p.prevPitch, p.flyPitch, TILT_RATE);
    p.roll = approach(p.prevRoll, p.flyBank, TILT_RATE);
    return false;
  },
};

export const FLYING_ACTIONS = { flying };
