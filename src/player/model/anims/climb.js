// Ledge hanging/climbing and tree-trunk (pole) climbing. Placement follows the physics
// conventions in ../physicsLink.js: rs.pos is the physics feet position, the ledge lip is
// HANG_DEPTH above it and WALL_DIST in front, a trunk's surface is POLE_GAP in front.
// The poses lift the body into place and put the mittens on the lip / bark with arm IK.

import {
  TAU, clamp, smoothstep, unit, arms, leg, legs, stand, plantLeg, plantFeet, keyframes, reachArm,
} from '../kit.js';
import {
  HANG_DEPTH, WALL_DIST, LEDGE_CLIMB_TIME, POLE_GAP, POLE_CLIMB_PER_CYCLE, climbProgress,
} from '../physicsLink.js';

// ---- ledges ------------------------------------------------------------------------------
// Positions in the "lip frame": y above the ledge top, z past the wall face.

const HANG_FEET = 104; // Pip's boots dangle this far below the lip...
const HANG_BACK = 22; // ...with his origin this far out from the wall face.
const GRIP = { x: 21, y: 5, z: 5 }; // mitten centres: on the top, just past the edge
const CLIMB_INSET = 65; // typical distance the Player moves Pip in from the hang spot

// Where rs.pos is in the lip frame at climb progress u (0 = hanging).
function feetInLipFrame(u) {
  const { up, fwd } = climbProgress(u);
  return { y: -HANG_DEPTH * (1 - up), z: -WALL_DIST + CLIMB_INSET * fwd };
}

// Lifts the body from rs.pos to its hang spot; the lift shrinks as the physics catches up.
function hangLift(p, u) {
  const { up, fwd } = climbProgress(u);
  p.rootY += (HANG_DEPTH - HANG_FEET) * (1 - up);
  p.rootZ += (WALL_DIST - HANG_BACK) * (1 - fwd);
}

// Puts both mittens at lip-frame (±GRIP.x, y, z) with weight w.
function grip(p, u, y, z, w = 1) {
  const f = feetInLipFrame(u);
  reachArm(p, 'L', GRIP.x, y - f.y, z - f.z, w);
  reachArm(p, 'R', -GRIP.x, y - f.y, z - f.z, w);
}

// Hanging: body tipped into the wall, looking up over the lip, legs dangling and swaying.
function hangBody(p, t) {
  const sway = Math.sin(t * 2.2);
  p.flipPitch = 0.22;
  p.headPitch = -0.75;
  arms(p, 2.4, 0.4, 0.2); // IK start pose (elbows out)
  leg(p, 'L', -0.05 + 0.14 * sway, 0.3 + 0.12 * sway, 0.5);
  leg(p, 'R', -0.12 - 0.14 * sway, 0.22 - 0.1 * sway, 0.5);
  p.hipsYaw = 0.05 * sway;
}

function hang(p, c) {
  hangBody(p, c.t);
  hangLift(p, 0);
  grip(p, 0, GRIP.y, GRIP.z);
}

// The lip in the lifted body frame at climb progress u (what plantLeg needs as ground).
function lipAt(u) {
  const { up, fwd } = climbProgress(u);
  return { y: HANG_FEET * (1 - up), z: WALL_DIST - CLIMB_INSET * fwd - (WALL_DIST - HANG_BACK) * (1 - fwd) };
}

// Pull up on the arms (the body trails the fast physics rise a little so the mittens can
// stay on the lip), get a knee over the edge, crouch on top, stand up. Key times are
// fractions of the physics action (LEDGE_CLIMB_TIME).
const CLIMB_KEYS = [
  [0, (q) => hangBody(q, 0)],
  [0.25, (q) => {
    q.rootY = -6;
    q.rootZ = -6; // lean out from the wall so the knee can come up
    q.flipPitch = 0.2;
    q.spinePitch = 0.2;
    q.headPitch = -0.5;
    leg(q, 'L', 1.35, 2.1, 0.9);
    leg(q, 'R', 0.3, 0.8, 0.5);
    q.face = 'shout';
  }],
  [0.36, (q) => {
    const lip = lipAt(0.36);
    q.rootY = -14;
    q.rootZ = -4;
    q.flipPitch = 0.1;
    q.spinePitch = 0.45;
    q.headPitch = -0.4;
    plantLeg(q, 'L', lip.z - 10, lip.y + 12); // boot comes up level with the lip first...
    leg(q, 'R', 0, 0.7, 0.5);
    q.face = 'shout';
  }],
  [0.45, (q) => {
    const lip = lipAt(0.45); // ...then steps onto it
    q.rootY = -20;
    q.hipsPitch = 0.2;
    q.spinePitch = 0.6;
    q.headPitch = -0.35;
    plantLeg(q, 'L', lip.z + 10, lip.y);
    leg(q, 'R', -0.2, 0.6, 0.5);
    q.face = 'shout';
  }],
  [0.62, (q) => {
    const lip = lipAt(0.62);
    q.hipsY = -18;
    q.hipsPitch = 0.3;
    q.spinePitch = 0.5;
    q.headPitch = -0.25;
    plantFeet(q, lip.z + 12, lip.z + 6);
    arms(q, 0.9, 0.4, 0.6);
  }],
  [0.82, (q) => {
    q.hipsY = -8;
    q.hipsPitch = 0.15;
    q.spinePitch = 0.25;
    plantFeet(q, 6, -4);
    arms(q, 0.4, 0.4, 0.5);
  }],
  [1, stand],
];

function ledgeClimb(p, c) {
  const u = unit(c.t / LEDGE_CLIMB_TIME);
  keyframes(p, u, CLIMB_KEYS, c);
  hangLift(p, u);
  // Mittens stay on the lip while pulling up, walk onto the top, then let go.
  const walk = smoothstep(0.3, 0.5, u);
  grip(p, u, GRIP.y + 3 * walk, GRIP.z + 18 * walk, 1 - smoothstep(0.5, 0.72, u));
}

// ---- trunks -------------------------------------------------------------------------------

const HUG_Z = 7; // body pressed up to the bark (chest ~5 off the surface)
const HAND_X = 30; // mittens wrap the trunk's front-left / front-right, ~12 past its face
const HAND_Z = POLE_GAP + 8;
const HAND_Y = 96;

// Hugging the trunk: knees apart gripping the bark, head tipped back looking up the trunk
// (which also keeps the big hat brim clear of it).
function hug(p, t) {
  p.rootZ = HUG_Z;
  p.spinePitch = 0.08;
  p.headPitch = -0.55;
  p.headYaw = 0.3 + 0.1 * Math.sin(t * 1.8); // cheek to the bark
  arms(p, 1.6, 0.6, 1.0);
  legs(p, 1.0, 1.55, -0.1, 0.5);
}

function poleHold(p, c) {
  hug(p, c.t);
  p.rootY = 0.8 * Math.sin(c.t * 1.8);
  reachArm(p, 'L', HAND_X, HAND_Y, HAND_Z);
  reachArm(p, 'R', -HAND_X, HAND_Y, HAND_Z);
}

// Shimmying up hand over hand. rs.pos rises steadily, so a gripping mitten slides down in
// body space at the climb rate while the other one reaches up past the head; the knees
// squeeze and push in alternation. One grip per half cycle.
const GRIP_TRAVEL = POLE_CLIMB_PER_CYCLE / 2;
function poleClimb(p, c) {
  hug(p, c.t);
  const w = c.ph * TAU;
  const s = Math.sin(w);
  for (const [side, phase, x] of [['L', 0, HAND_X], ['R', 0.5, -HAND_X]]) {
    const u = (c.ph + phase) % 1; // 0..0.5 gripping, 0.5..1 reaching up
    const holding = u < 0.5;
    const k = holding ? u / 0.5 : smoothstep(0.5, 1, u);
    const top = HAND_Y + 0.55 * GRIP_TRAVEL;
    const y = holding ? top - GRIP_TRAVEL * k : top - GRIP_TRAVEL * (1 - k);
    reachArm(p, side, x, clamp(y, 60, 125), HAND_Z - (holding ? 0 : 5 * Math.sin(TAU * k / 2)));
  }
  p.kneeL += 0.35 * s;
  p.kneeR -= 0.35 * s;
  p.legLSwing += 0.2 * s;
  p.legRSwing -= 0.2 * s;
  p.rootY = 3 * s;
  p.spineRoll = 0.05 * s;
  p.face = 'shout';
}

export const CLIMB_ANIMS = {
  ledge_hang: { pose: hang, blend: 0.08 },
  ledge_climb: { pose: ledgeClimb, blend: 0.05 },
  pole_hold: { pose: poleHold },
  pole_climb: { pose: poleClimb },
};
