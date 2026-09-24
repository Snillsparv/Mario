// Ledge hanging/climbing and tree-trunk (pole) climbing. Placement follows the physics
// conventions in ../physicsLink.js: rs.pos is the physics feet position, the ledge lip is
// HANG_DEPTH above it and WALL_DIST in front, a trunk's surface is POLE_GAP in front.
// The poses lift the body into place and put the mittens on the lip / bark with arm IK.

import {
  PI, TAU, clamp, smoothstep, unit, easeInOut, easeOut, hump, arms, leg, legs, stand, plantLeg, plantFeet, keyframes,
  reachArm, shoulderAt,
} from '../kit.js';
import { createPose, resetPose, blendPose } from '../pose.js';
import { FOREARM, HAND_OFFSET, UPPER_ARM } from '../dims.js';
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
  for (let i = 0; i < 2; i++) {
    const u = (c.ph + 0.5 * i) % 1; // 0..0.5 gripping, 0.5..1 reaching up
    const holding = u < 0.5;
    const k = holding ? u / 0.5 : smoothstep(0.5, 1, u);
    const top = HAND_Y + 0.55 * GRIP_TRAVEL;
    const y = holding ? top - GRIP_TRAVEL * k : top - GRIP_TRAVEL * (1 - k);
    reachArm(p, i ? 'R' : 'L', i ? -HAND_X : HAND_X, clamp(y, 60, 125), HAND_Z - (holding ? 0 : 5 * Math.sin(TAU * k / 2)));
  }
  p.kneeL += 0.35 * s;
  p.kneeR -= 0.35 * s;
  p.legLSwing += 0.2 * s;
  p.legRSwing -= 0.2 * s;
  p.rootY = 3 * s;
  p.spineRoll = 0.05 * s;
  p.face = 'shout';
}

// ---- pole-top handstand --------------------------------------------------------------------
// rs.pos is the pole tip: both mittens rest side by side on it, arms straight, and Pip
// stands on them upside down with his chest to the front (+Z) and legs up (a little apart,
// knees soft), swaying gently as he balances about his hands. His arms are short for his
// big head, so the chin is tucked: the head and hat sit forward of the tip, above it, and
// the scarf tails hang free down the back of the neck. He gets there with a quick
// cartwheel up from wherever the previous anim had him (ctx.entry*, carried by the
// animator from pole_hold / pole_climb).

const TIP_HAND_X = 7.5; // mitten centres either side of the tip...
const TIP_HAND_Y = 7.5; // ...and above it: the mittens rest on the tip
const ARM_REACH = UPPER_ARM + FOREARM + HAND_OFFSET - 0.2; // shoulder -> mitten, arm straight
const FLIP_TIME = 0.32;
const HS_LEAN = -0.35; // body tipped back over the hands (legs behind), against the head's weight

const sL = { x: 0, y: 0, z: 0 };
const sR = { x: 0, y: 0, z: 0 };

// The balancing sway (radians): a slow wander from two incommensurate sines per axis.
const swayRoll = (t) => 0.075 * Math.sin(t * 2.1) + 0.03 * Math.sin(t * 3.7 + 1);
const swayPitch = (t) => 0.05 * Math.sin(t * 1.6 + 0.5) + 0.02 * Math.sin(t * 4.3);

// The inverted body before it is placed on the hands. w (0..1) fades the sway in.
function handstandBody(p, t, w) {
  const r = swayRoll(t) * w;
  const f = swayPitch(t) * w;
  const V = globalThis.__hs ?? {};
  p.flipRoll = PI + r;
  p.flipPitch = (V.lean ?? HS_LEAN) + f;
  p.spinePitch = V.spine ?? -0.05;
  p.hipsPitch = V.hips ?? 0;
  p.headPitch = V.head ?? 1.0;
  // Legs catch the balance: they part toward the side the body tips away from, and the
  // knees give a little as it tips.
  const soft = 0.22 + 0.5 * Math.abs(f) + 0.3 * Math.abs(r);
  const arch = V.arch ?? 0.15;
  const point = V.point ?? 1.0;
  leg(p, 'L', arch - 0.04 - 1.2 * f, soft + 0.08 * Math.sin(t * 2.9), point, 0.16 - 1.4 * r);
  leg(p, 'R', arch - 1.2 * f, soft + 0.08 * Math.sin(t * 2.9 + 2), point, 0.16 + 1.4 * r);
  arms(p, 2.9, 0.3, 0.05);
  p.face = 'open';
}

// Moves the body so both shoulders are within a straight arm of the mittens on the tip,
// the arms leaning with the body (the sway pivots about the hands), then puts the mittens
// there. w (0..1) blends the hands in over the current arm pose. Returns the left mitten's
// x on the tip (each mitten goes on its own shoulder's side: upside down, left is -X).
function standOnHands(p, w = 1) {
  shoulderAt(p, 'L', sL);
  shoulderAt(p, 'R', sR);
  const hx = sL.x >= sR.x ? TIP_HAND_X : -TIP_HAND_X;
  const half = Math.hypot(sL.x - sR.x, sL.y - sR.y, sL.z - sR.z) / 2;
  const up = Math.sqrt(ARM_REACH * ARM_REACH - (half - TIP_HAND_X) ** 2);
  // Head direction of the inverted body = the arms' direction (hands below the shoulders).
  const r = p.flipRoll - PI;
  const f = p.flipPitch - (globalThis.__hs?.lean ?? HS_LEAN) + (globalThis.__hs?.armLean ?? 0);
  const dx = -Math.sin(r) * up;
  const dy = Math.cos(r) * Math.cos(f) * up;
  const dz = Math.cos(r) * Math.sin(f) * up;
  p.rootX += dx - (sL.x + sR.x) / 2;
  p.rootY += TIP_HAND_Y + dy - (sL.y + sR.y) / 2;
  p.rootZ += dz - (sL.z + sR.z) / 2;
  // A tipped body puts one shoulder further from its mitten: lower it into reach.
  shoulderAt(p, 'L', sL);
  shoulderAt(p, 'R', sR);
  const far = Math.max(
    Math.hypot(sL.x - hx, sL.y - TIP_HAND_Y, sL.z),
    Math.hypot(sR.x + hx, sR.y - TIP_HAND_Y, sR.z),
  );
  if (far > ARM_REACH) p.rootY -= far - ARM_REACH;
  reachArm(p, 'L', hx, TIP_HAND_Y, 0, w, 1);
  reachArm(p, 'R', -hx, TIP_HAND_Y, 0, w, 1);
  return hx;
}

const hugPose = createPose();
function poleHandstand(p, c) {
  const u = unit(c.t / FLIP_TIME);
  const settle = smoothstep(FLIP_TIME, FLIP_TIME + 0.6, c.t);
  handstandBody(p, c.t, settle);
  const hx = standOnHands(p);
  if (u >= 1) return;
  // The cartwheel up: from hugging the trunk where the previous anim left him (the entry
  // offset), up over the tip, tucking the knees as he rolls, and onto the hands.
  poleHold(resetPose(hugPose), c);
  hugPose.rootX += c.entryX;
  hugPose.rootY += c.entryY;
  hugPose.rootZ += c.entryZ;
  const e = easeInOut(u);
  const roll = p.flipRoll;
  blendPose(p, hugPose, p, e);
  p.flipRoll = roll * easeInOut(unit((u - 0.15) / 0.85));
  p.rootY += 40 * hump(u);
  const tuck = hump(unit((u - 0.1) / 0.8));
  p.legLSwing += 1.1 * tuck;
  p.legRSwing += 1.1 * tuck;
  p.kneeL += 1.3 * tuck;
  p.kneeR += 1.3 * tuck;
  reachArm(p, 'L', hx, TIP_HAND_Y, 0, smoothstep(0.1, 0.55, u), 1);
  reachArm(p, 'R', -hx, TIP_HAND_Y, 0, smoothstep(0.1, 0.55, u), 1);
  p.face = 'shout';
}

export const CLIMB_ANIMS = {
  ledge_hang: { pose: hang, blend: 0.08 },
  ledge_climb: { pose: ledgeClimb, blend: 0.05 },
  // Back down from the handstand (rs.pos drops from the tip to the climbing spot): carried.
  pole_hold: { pose: poleHold, carryFrom: ['pole_handstand'] },
  pole_climb: { pose: poleClimb, carryFrom: ['pole_handstand'] },
  // Slow to leave: turning upright again (into a jump or back onto the trunk) takes a beat.
  pole_handstand: { pose: poleHandstand, blend: 0.06, blendOut: 0.28, carryFrom: ['pole_hold', 'pole_climb'] },
};
