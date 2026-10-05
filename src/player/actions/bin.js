// Grabbing a wheelie bin and pulling (or pushing) it about (Sparrow Lane's bins,
// objects/laneBoss/LaneBins.js; docs/ARCHITECTURE.md "Sparrow Lane"): B next to a bin, facing
// it, grabs it with both mittens; the stick then moves Pip along his facing only, forward
// pushing it ahead of him, back pulling it after him, as the bin follows (LaneBins moves it after
// his tick); B, Z, A (a jump), a sideways stick, a hurt or the bin sent home lets go.
//
// The bins publish their grip record as `player.binGrip` (objects set it; null: no movable bins
// here):
//   { bins: [{ x, y, z, hw, hd, active }],   each bin's middle at its foot (world), its half
//                                            sizes along x and z (they never turn), whether it
//                                            can be grabbed now
//     held,                                  the bin held (its index; -1: none): set here on a
//                                            grab, LaneBins clears it when he lets go
//     nx, nz,                                the held face's outward normal (he faces -n)
//     blocked,                               +1: the bin cannot go further ahead (he cannot push
//                                            on), -1: nor follow him back (LaneBins sets it;
//                                            0: free)
//     release }                              LaneBins asks him to let go (the bin went home)
//
// Actions:
//   bin_hold  (group 'moving'; anims 'bin_hold' standing, 'bin_push' pushing, 'bin_pull' pulling)
//             gripping the bin, squared up to its face BIN_HOLD from it; the stick moves him
//             along his facing at BIN_DRAG_SPEED (never turning him), as long as `blocked`
//             allows; a stick held across his facing BIN_SIDE_TICKS lets go.

import * as T from '../physics/tuning.js';
import { groundStep, STEP_LEFT_GROUND } from '../physics/step.js';
import { setForwardVel } from '../physics/movement.js';
import { fallOff, jumpFromGround } from './common.js';
import { GRAB_FROM } from './tail.js';

// Where his mittens hold the bin, in his body space: on its face (a bin is as tall as he is: on
// its body, as high as his arms reach), each HALF_WIDTH to a side.
export const BIN_HANDS = { AHEAD: T.BIN_HOLD - 11, UP: 102, HALF_WIDTH: 17 };

function stop(p) {
  setForwardVel(p, 0);
  p.vel.y = 0;
}

// B pressed: grabs the bin in reach, if any (Pip on the ground, standing or walking, his feet
// within BIN_GRAB_REACH of one of its faces and in front of it, on its level, facing it within
// acos(BIN_GRAB_COS)); he squares up to that face. Returns true when the grab started.
export function tryGrabBin(p) {
  const g = p.binGrip;
  if (!g || !p.grounded || !GRAB_FROM.has(p.action)) return false;
  const fx = Math.sin(p.faceYaw);
  const fz = Math.cos(p.faceYaw);
  let best = -1;
  let bestD = T.BIN_GRAB_REACH;
  let nx = 0;
  let nz = 0;
  for (let i = 0; i < g.bins.length; i++) {
    const b = g.bins[i];
    if (!b.active || Math.abs(p.pos.y - b.y) > T.BIN_GRAB_REACH_Y) continue;
    const ox = p.pos.x - b.x;
    const oz = p.pos.z - b.z;
    // The face he stands before: the side he is furthest out past.
    const alongX = Math.abs(ox) - b.hw > Math.abs(oz) - b.hd;
    const d = alongX ? Math.abs(ox) - b.hw : Math.abs(oz) - b.hd;
    const side = alongX ? Math.abs(oz) - b.hd : Math.abs(ox) - b.hw;
    if (d < 0 || d > bestD || side > T.BIN_GRAB_SIDE) continue;
    const n = alongX ? Math.sign(ox) : Math.sign(oz);
    // Facing it: his facing against the face's normal.
    if (-(alongX ? fx * n : fz * n) < T.BIN_GRAB_COS) continue;
    best = i;
    bestD = d;
    nx = alongX ? n : 0;
    nz = alongX ? 0 : n;
  }
  if (best < 0) return false;
  const b = g.bins[best];
  // Squared up to the face: BIN_HOLD out from it, in front of it (within its edges), facing in.
  const x = nx !== 0 ? b.x + nx * (b.hw + T.BIN_HOLD) : Math.min(b.x + b.hw - 12, Math.max(b.x - b.hw + 12, p.pos.x));
  const z = nz !== 0 ? b.z + nz * (b.hd + T.BIN_HOLD) : Math.min(b.z + b.hd - 12, Math.max(b.z - b.hd + 12, p.pos.z));
  // ...where he fits (the spot clear of walls, a floor at his level), else no grab.
  const w = p.collision.findWalls(x, p.pos.y, z, 60, 48);
  if (Math.abs(w.x - x) + Math.abs(w.z - z) > 1) return false;
  const floor = p.collision.findFloor(x, p.pos.y + 30, z);
  if (!floor.surface || Math.abs(floor.y - p.pos.y) > 30) return false;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = floor.y;
  p.floor = floor;
  p.faceYaw = Math.atan2(-nx, -nz);
  g.held = best;
  g.nx = nx;
  g.nz = nz;
  g.blocked = 0;
  g.release = false;
  p.setAction('bin_hold');
  return true;
}

// Let go of the bin: standing (LaneBins sees he is no longer in bin_hold).
function letGo(p) {
  const g = p.binGrip;
  if (g) g.held = -1;
  stop(p);
  p.setAction('idle');
  return false;
}

const binHold = {
  group: 'moving',
  anim: 'bin_hold',
  enter(p) {
    stop(p);
    p.binSide = 0;
    p.sfx('ledge_grab');
  },
  update(p, c) {
    const g = p.binGrip;
    if (!g || g.held < 0 || g.release) return letGo(p);
    if (p.actionTimer >= 1 && (c.B.pressed || c.Z.pressed)) {
      p.pressGuard = true; // (the press that let go neither punches nor crouches)
      return letGo(p);
    }
    if (c.A.pressed) {
      g.held = -1;
      return jumpFromGround(p);
    }
    // The stick along his facing: forward pushes, back pulls; across it, held, lets go.
    let dir = 0;
    if (p.stickHeld) {
      const along = Math.cos(p.intendedYaw - p.faceYaw);
      if (along >= T.BIN_ALONG_COS) dir = 1;
      else if (along <= -T.BIN_ALONG_COS) dir = -1;
      else if (++p.binSide >= T.BIN_SIDE_TICKS) return letGo(p);
    }
    if (dir !== 0) p.binSide = 0;
    if (dir === 0 || g.blocked === dir) {
      stop(p);
      p.setAnim(dir > 0 ? 'bin_push' : 'bin_hold');
      return false;
    }
    setForwardVel(p, dir * T.BIN_DRAG_SPEED);
    const r = groundStep(p);
    if (r.result === STEP_LEFT_GROUND) {
      g.held = -1;
      return fallOff(p);
    }
    if (dir > 0) p.setAnim('bin_push');
    else {
      p.setAnim('bin_pull');
      p.cyclePhase += T.BIN_DRAG_SPEED / T.STRIDE.walk;
    }
    return false;
  },
};

export const BIN_ACTIONS = { bin_hold: binHold };
