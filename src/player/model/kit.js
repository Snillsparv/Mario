// Small toolkit shared by the pose functions: easing curves, limb setters, two-bone
// solvers that keep boots planted on the floor and put mittens on a ledge / trunk / wall,
// and keyframe blending between sub-poses.

import * as THREE from 'three';
import { clamp, smoothstep, TAU } from '../../core/math.js';
import { createPose, resetPose, blendPose } from './pose.js';
import {
  ANKLE_Y, CENTER, FOREARM, HAND_OFFSET, HIP_DROP, HIP_X, HIP_Y, SHIN, SHOULDER_X, SHOULDER_Y, SPINE_Y, THIGH,
  UPPER_ARM,
} from './dims.js';

export { clamp, smoothstep, TAU };
export const PI = Math.PI;

export const unit = (x) => clamp(x, 0, 1);
export const easeOut = (x) => 1 - (1 - unit(x)) ** 3;
export const easeIn = (x) => unit(x) ** 2;
export const easeInOut = (x) => {
  const u = unit(x);
  return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) ** 2;
};
// Overshoots a little before settling: snappy cartoon pops.
export const easeOutBack = (x) => {
  const u = unit(x) - 1;
  return 1 + u * u * (2.6 * u + 1.6);
};
// 0 -> 1 -> 0 over [0, 1].
export const hump = (x) => Math.sin(PI * unit(x));

// Sets one arm; side is 'L' or 'R'. (The per-side helpers write channels by name, never
// p[name], which would box every number: see pose.js.)
export function arm(p, side, swing, raise, elbow, sweep = 0) {
  if (side === 'L') {
    p.armLSwing = swing;
    p.armLRaise = raise;
    p.elbowL = elbow;
    p.armLSweep = sweep;
  } else {
    p.armRSwing = swing;
    p.armRRaise = raise;
    p.elbowR = elbow;
    p.armRSweep = sweep;
  }
}

export function arms(p, swing, raise, elbow, sweep = 0) {
  arm(p, 'L', swing, raise, elbow, sweep);
  arm(p, 'R', swing, raise, elbow, sweep);
}

export function leg(p, side, swing, knee, ankle = 0, spread = 0) {
  if (side === 'L') {
    p.legLSwing = swing;
    p.kneeL = knee;
    p.ankleL = ankle;
    p.legLSpread = spread;
  } else {
    p.legRSwing = swing;
    p.kneeR = knee;
    p.ankleR = ankle;
    p.legRSpread = spread;
  }
}

export function legs(p, swing, knee, ankle = 0, spread = 0) {
  leg(p, 'L', swing, knee, ankle, spread);
  leg(p, 'R', swing, knee, ankle, spread);
}

// Attack swell (0 = normal size, 0.8 = 1.8x) of one mitten / boot; side is 'L' or 'R'.
export function swellHand(p, side, v) {
  if (side === 'L') p.handLSwell = v;
  else p.handRSwell = v;
}

export function swellFoot(p, side, v) {
  if (side === 'L') p.footLSwell = v;
  else p.footRSwell = v;
}

// The cartoon strike swell: pops out over `grow` s (a little overshoot), holds until
// `hold`, deflates by `end`. Returns 0..~1.1 (multiply by the swell amount).
export const STRIKE_SWELL = 0.8; // boots on kicks: 1.8x
export const PUNCH_SWELL = 1.1; // fists on punches: 2.1x (a fist is smaller than a boot)
export function strikeSwell(t, grow, hold, end) {
  return t < grow ? easeOutBack(t / grow) : 1 - smoothstep(hold, end, t);
}

// Relaxed standing: arms hang a little away from the tunic with soft elbows.
export function stand(p) {
  arms(p, 0.05, 0.24, 0.3);
  return p;
}

// Leans the whole body sideways by `roll` (flipRoll sign) about the floor between the
// boots rather than the belly, so a turn lean keeps planted boots on the ground. Call it
// before the leg IK.
export function bankAtFeet(p, roll) {
  p.flipRoll += roll;
  p.rootX -= CENTER * Math.sin(roll);
  p.rootY -= CENTER * (1 - Math.cos(roll));
}

// ---- limb IK ---------------------------------------------------------------------------
// Targets are in body space (feet origin, +Z front; before the RenderState pitch/roll). The
// solvers account for the root offset, flips, squash and the hips (and, for arms, spine)
// rotations, so call them after setting those channels.

const FORE = FOREARM + HAND_OFFSET;
const chain = new THREE.Matrix4();
const tmpM = new THREE.Matrix4();
const tmpE = new THREE.Euler();
const tmpQ = new THREE.Quaternion();
const origin = new THREE.Vector3();
const squash = new THREE.Vector3();
const target = new THREE.Vector3();
const pole = new THREE.Vector3();
const upper = new THREE.Vector3();
const fore = new THREE.Vector3();
const bend = new THREE.Vector3();
const side = new THREE.Vector3();

const rotation = (x, y, z, order) => tmpM.makeRotationFromEuler(tmpE.set(x, y, z, order));

// Body space -> pelvis frame, mirroring the rig hierarchy in rig.js (into `chain`).
function bodyToHips(p) {
  const sy = Math.max(0.3, 1 + p.squash);
  squash.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
  return chain.makeTranslation(p.rootX, CENTER + p.rootY, p.rootZ)
    .multiply(rotation(p.flipPitch, p.flipYaw, p.flipRoll, 'YXZ'))
    .multiply(tmpM.makeTranslation(0, -CENTER, 0))
    .multiply(tmpM.compose(origin, tmpQ.identity(), squash))
    .multiply(tmpM.makeTranslation(0, HIP_Y + p.hipsY, 0))
    .multiply(rotation(p.hipsPitch, p.hipsYaw, p.hipsRoll, 'XYZ'));
}

// Two-bone leg IK in the thigh's swing plane: puts the ankle at (z, y) in body space (at
// whatever sideways offset the plane has there; legXSpread is left alone) with the boot
// pitched `toePitch` from flat (+ = toes down, - = heel down).
export function legTo(p, s, z, y, toePitch = 0) {
  const hx = s === 'L' ? HIP_X : -HIP_X;
  const m = bodyToHips(p).multiply(tmpM.makeTranslation(hx, -HIP_DROP, 0)).invert();
  // The x (body space) at which (x, y, z) lies in the thigh's swing plane (thigh x = 0).
  const e = m.elements;
  const x = Math.abs(e[0]) > 0.3 ? -(e[4] * y + e[8] * z + e[12]) / e[0] : hx;
  const t = target.set(x, y, z).applyMatrix4(m);
  const dy = t.y;
  const dz = t.z;
  const d = clamp(Math.sqrt(dy * dy + dz * dz), Math.abs(THIGH - SHIN) + 0.01, THIGH + SHIN - 0.01);
  const knee = PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1));
  const aim = Math.atan2(dz, -dy);
  const lead = Math.acos(clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
  const swing = aim + lead;
  // The boot's pitch is the sum of everything above it: cancel it, then add toePitch.
  const ankle = toePitch - p.flipPitch - p.hipsPitch + swing - knee;
  if (s === 'L') {
    p.legLSwing = swing;
    p.kneeL = knee;
    p.ankleL = ankle;
  } else {
    p.legRSwing = swing;
    p.kneeR = knee;
    p.ankleR = ankle;
  }
}

// Keeps a boot flat on the floor at height groundY, footZ forward of the body origin.
export function plantLeg(p, s, footZ, groundY = 0) {
  legTo(p, s, footZ, groundY + ANKLE_Y);
}

export function plantFeet(p, zL, zR, groundY = 0) {
  plantLeg(p, 'L', zL, groundY);
  plantLeg(p, 'R', zR, groundY);
}

// Two-bone arm IK: bends the elbow and aims the shoulder so the mitten centre lands on
// (x, y, z), blended over the current arm pose by weight w. `elbowOut` (0..1) swings the
// elbow from pointing down-and-back to pointing out sideways. Out-of-reach targets get a
// straight arm pointing at them.
export function reachArm(p, s, x, y, z, w = 1, elbowOut = 0.3) {
  if (w <= 0) return;
  const frame = bodyToHips(p)
    .multiply(tmpM.makeTranslation(0, SPINE_Y, 0))
    .multiply(rotation(p.spinePitch, p.spineYaw, p.spineRoll, 'XYZ'))
    .multiply(tmpM.makeTranslation(s === 'L' ? SHOULDER_X : -SHOULDER_X, SHOULDER_Y, 0));
  // Solve as a left arm (+X = outward); the rig mirrors the right one.
  const t = target.set(x, y, z).applyMatrix4(frame.invert());
  if (s === 'R') t.x = -t.x;
  const d = clamp(t.length(), FORE - UPPER_ARM + 0.5, UPPER_ARM + FORE - 0.01);
  t.setLength(d);
  // Elbow on the circle of solutions, on the side of the pole direction.
  const dir = side.copy(t).divideScalar(d);
  pole.set(elbowOut, -1 + elbowOut, -0.5 * (1 - elbowOut));
  pole.addScaledVector(dir, -pole.dot(dir)).normalize();
  const a = (UPPER_ARM * UPPER_ARM - FORE * FORE + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - a * a));
  upper.copy(dir).multiplyScalar(a).addScaledVector(pole, h); // elbow position
  fore.subVectors(t, upper).normalize();
  upper.normalize();
  const elbow = Math.acos(clamp(upper.dot(fore), -1, 1));
  // The forearm bends toward +Z of the upper-arm frame: that axis is the bend direction.
  bend.copy(fore).addScaledVector(upper, -upper.dot(fore));
  if (bend.lengthSq() < 1e-8) bend.copy(pole).negate().addScaledVector(upper, pole.dot(upper));
  bend.normalize();
  upper.negate(); // the frame's +Y (the arm hangs along -Y)
  side.crossVectors(upper, bend);
  tmpE.setFromRotationMatrix(tmpM.makeBasis(side, upper, bend), 'XYZ'); // (-swing, -sweep, raise)
  if (s === 'L') {
    p.armLSwing = mixAngle(p.armLSwing, -tmpE.x, w);
    p.armLSweep = mixAngle(p.armLSweep, -tmpE.y, w);
    p.armLRaise = mixAngle(p.armLRaise, tmpE.z, w);
    p.elbowL = mixAngle(p.elbowL, elbow, w);
  } else {
    p.armRSwing = mixAngle(p.armRSwing, -tmpE.x, w);
    p.armRSweep = mixAngle(p.armRSweep, -tmpE.y, w);
    p.armRRaise = mixAngle(p.armRRaise, tmpE.z, w);
    p.elbowR = mixAngle(p.elbowR, elbow, w);
  }
}

// `from` moved toward angle a by weight w, the short way round.
function mixAngle(from, a, w) {
  return from + (wrapNear(a, from) - from) * w;
}

// The equivalent angle closest to `ref` (so blends never take the long way round).
function wrapNear(a, ref) {
  return a + TAU * Math.round((ref - a) / TAU);
}

// The fully tucked "cannonball" used by somersaults: knees to chest, arms hugging shins.
export function tuck(p, amount = 1) {
  const a = amount;
  p.hipsY += 8 * a;
  p.spinePitch += 0.5 * a;
  p.headPitch += 0.35 * a;
  arms(p, 1.25 * a, 0.35, 1.7 * a, 0.2 * a);
  legs(p, 1.75 * a, 2.3 * a, 0.5 * a, 0.12 * a);
}

// Keyframed sub-poses. keys = [[time, poseFn], ...] sorted by time; poseFn(p) fills a
// fresh (reset) pose. Between keys the two neighbouring poses are blended with a smooth
// curve, so complex moves (ledge climb, star dance) can be authored as a few key poses.
const keyA = createPose();
const keyB = createPose();
export function keyframes(p, t, keys, c) {
  let i = 0;
  while (i < keys.length - 1 && t >= keys[i + 1][0]) i++;
  const t0 = keys[i][0];
  const next = keys[Math.min(i + 1, keys.length - 1)];
  keys[i][1](resetPose(keyA), c);
  if (next === keys[i]) return blendPose(p, keyA, keyA, 1);
  next[1](resetPose(keyB), c);
  const u = easeInOut((t - t0) / (next[0] - t0));
  return blendPose(p, keyA, keyB, u);
}
