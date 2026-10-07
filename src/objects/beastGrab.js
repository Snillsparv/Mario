// Rustmaw's tail grab and a thrown beast's flight (objects/RobotBeast.js, in the aiRace chunk,
// and the boss camera, camera/bossCam.js, in main: so main does not reach the beast for them).
//
//   GRAB                         the grab's numbers (see RobotBeast.js's header)
//   flightPoint(f, t, out)       where a thrown beast's waist is t ticks into its flight

import { TAIL_RAISE_TICKS } from '../player/physics/tuning.js';

const DEG = Math.PI / 180;

// The tail grab (see the top). Angles in radians, times in ticks.
export const GRAB = {
  // Haul keys [bearing from its facing, elevation (deg), tail straightened 0..1, roll (deg),
  // time 0..1]: from lying on the ridge (0, 0, 0, 0) up into the whirl. Found against the real
  // castle with tests/boss-throw.test.js's clearance check (it swings up east of the spire).
  HAUL: [
    [0, 0, 0, 0, 0],
    [8, 14, 0.1, 0, 0.2],
    [22, 30, 0.3, 0, 0.45],
    [40, 45, 0.6, 60, 0.7],
    [45, 68, 1, 180, 1],
  ],
  HAUL_TICKS: TAIL_RAISE_TICKS,
  THETA: 68 * DEG, // the whirling body's elevation from the hero's hands
  ROLL: Math.PI, // belly up (its splayed legs flail inward, not down into the towers)
  WOBBLE: 0.03, // elevation wobble while whirling
  FLAIL_ROLL: 0.22, // roll wobble while whirling
  THROW_MIN: 0.15, // spin (rad/tick) a throw needs
  RELEASE_GRACE: 75, // ticks after it is let go before it shoots again
  HOLD_ROAR: 50, // a held beast starts another roar this often (ticks) once the last is over
  // The throw's flight: ballistic under THROW_GRAVITY, its waist's apex THROW_APEX over the
  // castle's top (T within THROW_T), levelling out of the whirl, spinning and rolling (FLY_*;
  // both scaled to end lined up with the wreck), set down on its back over the last CRASH_BLEND
  // ticks. The landing spot keeps LAND_MARGIN clear of the castle's footprint (LAND_MARGIN_FRONT
  // in front) and LAND_EDGE inside the level's perimeter, with room for the wreck (WRECK_*,
  // LAND_*: _wreckFit); lying on its back its waist is LAND_REST over the ground.
  THROW_GRAVITY: 5,
  THROW_APEX: 2600, // the waist's apex over the castle's top (layout.CASTLE.keepTopY)
  THROW_T: [50, 110],
  FLY_HOLD: 6, // ticks it keeps the whirl's steep pose, rising, before it levels out...
  FLY_SETTLE: 14, // ...over this many
  FLY_PITCH: 0.12, // flying nose up this much...
  FLY_SPIN: 0.85, // ...spinning flat at this much of the throw's spin at first...
  FLY_SPIN_DECAY: 18, // ...dying away over about this many ticks...
  FLY_YAW: 0.05, // ...to this (rad/tick)...
  FLY_ROLL: 0.075, // ...and barrel-rolling (rad/tick)
  CRASH_BLEND: 16,
  WRECK_PITCH: 0, // on its back, level (its neck curls its head up off the ground)
  LAND_MARGIN: 2200,
  LAND_MARGIN_FRONT: 3400, // (it comes down over the facade's towers: land further out there)
  WRECK_HEAD: 1900, // the wreck reaches this far ahead of its waist (head curled up)...
  WRECK_TAIL: 3000, // ...and this far behind (the tail)...
  WRECK_HALF_WIDTH: 450, // ...and this far to either side
  LAND_END: 500, // its ends stay this far clear of the castle and inside the perimeter
  LAND_BUMP: 180, // the ground along it at most this much higher than the spot
  LAND_EDGE: 2500,
  LAND_REST: 430,
  FALL_TICKS: 40, // twisting free: back onto its perch in an arc FALL_ARC high
  FALL_ARC: 1800,
  WRECK_TICKS: 96, // lying wrecked, then sinking away over SCRAP_TICKS by SCRAP_DEPTH
  SCRAP_TICKS: 60,
  SCRAP_DEPTH: 1500,
};

// Where a thrown beast's waist is t ticks into its flight f ({ x0, y0, z0, vx, vy, vz, T, g }):
// ballistic up and down (stepped like aimVelocity, so at t = T it is exactly on target), its
// way across eased in and out (it first shoots up out of the whirl, then drops onto the spot).
// Into `out` ({ x, y, z }). Also used by the camera (camera/bossCam.js, 'bossThrown').
export function flightPoint(f, t, out) {
  const u = t <= 0 ? 0 : t >= f.T ? 1 : t / f.T;
  const across = u * u * (3 - 2 * u) * f.T;
  out.x = f.x0 + f.vx * across;
  out.y = f.y0 + f.vy * t - (f.g * t * (t + 1)) / 2;
  out.z = f.z0 + f.vz * across;
  return out;
}
