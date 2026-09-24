// The physics numbers Pip's contact poses must agree with (ledges, trunks, walls, strokes,
// strides), read from the Player's tuning so the two sides cannot drift apart. Every value
// has a fallback, so the model keeps working if the Player renames or drops a constant.
//
// Placement conventions (rs.pos is always the physics feet position):
//   ledge_hang   the ledge top is HANG_DEPTH above rs.pos and its wall face WALL_DIST in
//                front; the pose lifts the body so the mittens rest on the lip.
//   ledge_climb  rs.pos moves from the hang spot onto the top as in climbProgress(); the
//                pose's lift shrinks with it and is zero when the action ends.
//   pole_*       the trunk surface is POLE_GAP in front of rs.pos (radius ~30-40); while
//                climbing, rs.pos rises POLE_CLIMB_PER_CYCLE per cyclePhase.
//   push         the wall face is WALL_DIST in front of rs.pos.
//   pole_handstand  rs.pos is the pole tip (under his hands), set without interpolation on
//                the tick the anim starts (and moved back to the climbing spot, again
//                without interpolation, when he climbs or lets go back down); he swings up
//                into the balanced handstand over POLE_TOP_SETTLE_TIME.

import * as T from '../physics/tuning.js';
import { FRAME_DT, PLAYER_RADIUS } from '../../core/constants.js';
import { smoothstep } from '../../core/math.js';

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

export const WALL_DIST = num(PLAYER_RADIUS, 50);
export const HANG_DEPTH = num(T.HANG_DEPTH, 160);
export const LEDGE_CLIMB_TIME = num(T.LEDGE_CLIMB_TICKS, 15) * FRAME_DT;
export const POLE_GAP = num(T.POLE_HOLD_DIST, 30);
// Height climbed per pole_climb cycle: the Player adds 0.08 cycles per tick of full-stick
// climbing (automatic.js) while rising POLE_CLIMB_SPEED units.
export const POLE_CLIMB_PER_CYCLE = num(T.POLE_CLIMB_SPEED, 7) / 0.08;
export const STROKE_TIME = num(T.STROKE_TICKS, 18) * FRAME_DT;
export const POLE_TOP_SETTLE_TIME = num(T.POLE_TOP_SETTLE_TICKS, 8) * FRAME_DT;

// Distance the Player advances per locomotion cycle (cyclePhase 1.0) for an anim, if any.
export function physicsStride(anim) {
  return num(T.STRIDE?.[anim], 0);
}

// How far the Player has moved the feet from the hang spot to the top of the ledge at
// climb progress u (0..1): mirrors ledgeClimb.update in src/player/actions/automatic.js.
export function climbProgress(u) {
  return { up: smoothstep(0, 0.6, u), fwd: smoothstep(0.35, 1, u) };
}
