// A pose is a flat record of joint angles (radians) and offsets (units). All channels are 0
// in the neutral T-less stance (arms hanging straight down, legs straight); pose functions
// build on top of that. Keeping it flat makes blending a simple per-channel lerp.
//
// Storage: every pose is made by createPose()'s one object literal, so all poses share a
// single fast V8 shape whose number fields are updated in place, and pose code (these
// whole-pose helpers, the per-side helpers in kit.js) names its channels instead of
// looping over p[c]. (A pose built key by key, p[c] = 0 for 38 channels, is a slow
// dictionary object, and p[c] reads and writes by a variable name box every number: a
// large share of the hero's per-frame garbage.) tests/model.test.js checks that the
// helpers cover every channel.
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
//   handXSwell / footXSwell   attack swell of a mitten (about the wrist) / boot (about
//              dims BOOT_PIVOT_Y): 0 = normal size, + = bigger (0.8 = 1.8x), on strikes

import { wrapAngle } from '../../core/math.js';

// A neutral pose (every channel 0, open eyes).
export function createPose() {
  return {
    rootX: 0, rootY: 0, rootZ: 0, floorPivot: 0,
    flipPitch: 0, flipYaw: 0, flipRoll: 0, squash: 0,
    hipsY: 0, hipsPitch: 0, hipsYaw: 0, hipsRoll: 0,
    spinePitch: 0, spineYaw: 0, spineRoll: 0,
    headPitch: 0, headYaw: 0, headRoll: 0,
    armLSwing: 0, armLRaise: 0, armLSweep: 0, elbowL: 0,
    armRSwing: 0, armRRaise: 0, armRSweep: 0, elbowR: 0,
    legLSwing: 0, legLSpread: 0, kneeL: 0, ankleL: 0,
    legRSwing: 0, legRSpread: 0, kneeR: 0, ankleR: 0,
    handLSwell: 0, handRSwell: 0, footLSwell: 0, footRSwell: 0,
    face: 'open',
  };
}

export const CHANNELS = Object.keys(createPose()).filter((c) => c !== 'face');

export function resetPose(p) {
  p.rootX = 0; p.rootY = 0; p.rootZ = 0; p.floorPivot = 0;
  p.flipPitch = 0; p.flipYaw = 0; p.flipRoll = 0; p.squash = 0;
  p.hipsY = 0; p.hipsPitch = 0; p.hipsYaw = 0; p.hipsRoll = 0;
  p.spinePitch = 0; p.spineYaw = 0; p.spineRoll = 0;
  p.headPitch = 0; p.headYaw = 0; p.headRoll = 0;
  p.armLSwing = 0; p.armLRaise = 0; p.armLSweep = 0; p.elbowL = 0;
  p.armRSwing = 0; p.armRRaise = 0; p.armRSweep = 0; p.elbowR = 0;
  p.legLSwing = 0; p.legLSpread = 0; p.kneeL = 0; p.ankleL = 0;
  p.legRSwing = 0; p.legRSpread = 0; p.kneeR = 0; p.ankleR = 0;
  p.handLSwell = 0; p.handRSwell = 0; p.footLSwell = 0; p.footRSwell = 0;
  p.face = 'open';
  return p;
}

export function copyPose(d, s) {
  d.rootX = s.rootX; d.rootY = s.rootY; d.rootZ = s.rootZ; d.floorPivot = s.floorPivot;
  d.flipPitch = s.flipPitch; d.flipYaw = s.flipYaw; d.flipRoll = s.flipRoll; d.squash = s.squash;
  d.hipsY = s.hipsY; d.hipsPitch = s.hipsPitch; d.hipsYaw = s.hipsYaw; d.hipsRoll = s.hipsRoll;
  d.spinePitch = s.spinePitch; d.spineYaw = s.spineYaw; d.spineRoll = s.spineRoll;
  d.headPitch = s.headPitch; d.headYaw = s.headYaw; d.headRoll = s.headRoll;
  d.armLSwing = s.armLSwing; d.armLRaise = s.armLRaise; d.armLSweep = s.armLSweep; d.elbowL = s.elbowL;
  d.armRSwing = s.armRSwing; d.armRRaise = s.armRRaise; d.armRSweep = s.armRSweep; d.elbowR = s.elbowR;
  d.legLSwing = s.legLSwing; d.legLSpread = s.legLSpread; d.kneeL = s.kneeL; d.ankleL = s.ankleL;
  d.legRSwing = s.legRSwing; d.legRSpread = s.legRSpread; d.kneeR = s.kneeR; d.ankleR = s.ankleR;
  d.handLSwell = s.handLSwell; d.handRSwell = s.handRSwell; d.footLSwell = s.footLSwell; d.footRSwell = s.footRSwell;
  d.face = s.face;
  return d;
}

// o = a + (b - a) * t per channel (o may alias a or b). The face comes from b. Whole-body
// rotations blend along the shortest arc, so leaving a flip never unwinds it.
export function blendPose(o, a, b, t) {
  o.rootX = a.rootX + (b.rootX - a.rootX) * t;
  o.rootY = a.rootY + (b.rootY - a.rootY) * t;
  o.rootZ = a.rootZ + (b.rootZ - a.rootZ) * t;
  o.floorPivot = a.floorPivot + (b.floorPivot - a.floorPivot) * t;
  o.flipPitch = a.flipPitch + wrapAngle(b.flipPitch - a.flipPitch) * t;
  o.flipYaw = a.flipYaw + wrapAngle(b.flipYaw - a.flipYaw) * t;
  o.flipRoll = a.flipRoll + wrapAngle(b.flipRoll - a.flipRoll) * t;
  o.squash = a.squash + (b.squash - a.squash) * t;
  o.hipsY = a.hipsY + (b.hipsY - a.hipsY) * t;
  o.hipsPitch = a.hipsPitch + (b.hipsPitch - a.hipsPitch) * t;
  o.hipsYaw = a.hipsYaw + (b.hipsYaw - a.hipsYaw) * t;
  o.hipsRoll = a.hipsRoll + (b.hipsRoll - a.hipsRoll) * t;
  o.spinePitch = a.spinePitch + (b.spinePitch - a.spinePitch) * t;
  o.spineYaw = a.spineYaw + (b.spineYaw - a.spineYaw) * t;
  o.spineRoll = a.spineRoll + (b.spineRoll - a.spineRoll) * t;
  o.headPitch = a.headPitch + (b.headPitch - a.headPitch) * t;
  o.headYaw = a.headYaw + (b.headYaw - a.headYaw) * t;
  o.headRoll = a.headRoll + (b.headRoll - a.headRoll) * t;
  o.armLSwing = a.armLSwing + (b.armLSwing - a.armLSwing) * t;
  o.armLRaise = a.armLRaise + (b.armLRaise - a.armLRaise) * t;
  o.armLSweep = a.armLSweep + (b.armLSweep - a.armLSweep) * t;
  o.elbowL = a.elbowL + (b.elbowL - a.elbowL) * t;
  o.armRSwing = a.armRSwing + (b.armRSwing - a.armRSwing) * t;
  o.armRRaise = a.armRRaise + (b.armRRaise - a.armRRaise) * t;
  o.armRSweep = a.armRSweep + (b.armRSweep - a.armRSweep) * t;
  o.elbowR = a.elbowR + (b.elbowR - a.elbowR) * t;
  o.legLSwing = a.legLSwing + (b.legLSwing - a.legLSwing) * t;
  o.legLSpread = a.legLSpread + (b.legLSpread - a.legLSpread) * t;
  o.kneeL = a.kneeL + (b.kneeL - a.kneeL) * t;
  o.ankleL = a.ankleL + (b.ankleL - a.ankleL) * t;
  o.legRSwing = a.legRSwing + (b.legRSwing - a.legRSwing) * t;
  o.legRSpread = a.legRSpread + (b.legRSpread - a.legRSpread) * t;
  o.kneeR = a.kneeR + (b.kneeR - a.kneeR) * t;
  o.ankleR = a.ankleR + (b.ankleR - a.ankleR) * t;
  o.handLSwell = a.handLSwell + (b.handLSwell - a.handLSwell) * t;
  o.handRSwell = a.handRSwell + (b.handRSwell - a.handRSwell) * t;
  o.footLSwell = a.footLSwell + (b.footLSwell - a.footLSwell) * t;
  o.footRSwell = a.footRSwell + (b.footRSwell - a.footRSwell) * t;
  o.face = b.face;
  return o;
}

// Bring whole-body rotations back into (-PI, PI] (used when snapshotting a pose mid-flip).
export function wrapFlips(p) {
  p.flipPitch = wrapAngle(p.flipPitch);
  p.flipYaw = wrapAngle(p.flipYaw);
  p.flipRoll = wrapAngle(p.flipRoll);
  return p;
}
