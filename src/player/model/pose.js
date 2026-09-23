// A pose is a flat record of joint angles (radians) and offsets (units). All channels are 0
// in the neutral T-less stance (arms hanging straight down, legs straight); pose functions
// build on top of that. Keeping it flat makes blending a simple per-channel lerp.
//
// Sign conventions (all "+" values are the natural, readable direction):
//   root*      offset of the whole body (units), applied before the flip rotation
//   floorPivot 0 = the RenderState pitch/roll pivots about the belly, 1 = about the feet
//   flipPitch  + = forward somersault      flipYaw + = spin to the left   flipRoll + = cartwheel
//   squash     + = stretched tall, - = squashed (volume preserving)
//   hipsY      pelvis drop/raise (units);  hipsPitch/spinePitch + = lean forward
//   headPitch  + = nod down;  headYaw + = look to Pip's left
//   armXSwing  + = arm swings forward/up;  armXRaise + = arm lifts out sideways
//   armXSweep  + = raised arm sweeps forward (horizontal plane);  elbowX + = bend
//   legXSwing  + = leg swings forward;  legXSpread + = leg out sideways
//   kneeX      + = bend (foot goes back);  ankleX + = toes point down

import { wrapAngle } from '../../core/math.js';

export const CHANNELS = [
  'rootX', 'rootY', 'rootZ', 'floorPivot', 'flipPitch', 'flipYaw', 'flipRoll', 'squash',
  'hipsY', 'hipsPitch', 'hipsYaw', 'hipsRoll',
  'spinePitch', 'spineYaw', 'spineRoll',
  'headPitch', 'headYaw', 'headRoll',
  'armLSwing', 'armLRaise', 'armLSweep', 'elbowL',
  'armRSwing', 'armRRaise', 'armRSweep', 'elbowR',
  'legLSwing', 'legLSpread', 'kneeL', 'ankleL',
  'legRSwing', 'legRSpread', 'kneeR', 'ankleR',
];

// Whole-body rotations: blended along the shortest arc so leaving a flip never unwinds it.
const FLIPS = new Set(['flipPitch', 'flipYaw', 'flipRoll']);

// Per-side channel names, so pose code can be written once for both arms/legs.
export const SIDE = {
  L: { swing: 'armLSwing', raise: 'armLRaise', sweep: 'armLSweep', elbow: 'elbowL',
    leg: 'legLSwing', spread: 'legLSpread', knee: 'kneeL', ankle: 'ankleL' },
  R: { swing: 'armRSwing', raise: 'armRRaise', sweep: 'armRSweep', elbow: 'elbowR',
    leg: 'legRSwing', spread: 'legRSpread', knee: 'kneeR', ankle: 'ankleR' },
};

export function createPose() {
  return resetPose({});
}

export function resetPose(p) {
  for (const c of CHANNELS) p[c] = 0;
  p.face = 'open';
  return p;
}

export function copyPose(dst, src) {
  for (const c of CHANNELS) dst[c] = src[c];
  dst.face = src.face;
  return dst;
}

// out = a + (b - a) * t per channel (out may alias a or b). The face comes from b.
export function blendPose(out, a, b, t) {
  for (const c of CHANNELS) {
    const va = a[c];
    const d = FLIPS.has(c) ? wrapAngle(b[c] - va) : b[c] - va;
    out[c] = va + d * t;
  }
  out.face = b.face;
  return out;
}

// Bring whole-body rotations back into (-PI, PI] (used when snapshotting a pose mid-flip).
export function wrapFlips(p) {
  for (const c of FLIPS) p[c] = wrapAngle(p[c]);
  return p;
}
