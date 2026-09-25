// Pip and Rustmaw's tail (actions/tail.js): gripping the tow coupling's bar in both mittens
// with his heels dug in, heaving the beast up off the roof and spinning round on the spot with
// his arms raised along the taut tail, then flinging it away. The mittens go where the beast
// hangs its coupling (TAIL_HANDS, in body space), so tail and hands meet on screen.

import { TAU, smoothstep, unit, easeOut, arm, arms, plantLeg, reachArm, keyframes, stand, plantFeet } from '../kit.js';
import { TAIL_HANDS as H } from '../../actions/tail.js';
import { TAIL_RAISE_TICKS } from '../../physics/tuning.js';

const RAISE_TIME = TAIL_RAISE_TICKS / 30; // the hands rise with the haul (seconds)

// Both mittens on the bar, `ahead` in front of the feet and `up` high.
function grip(p, ahead, up, elbowOut = 0.55) {
  arms(p, 1.3, 0.25, 0.35); // IK start pose: arms forward, elbows out
  reachArm(p, 'L', H.HALF_WIDTH, up, ahead, 1, elbowOut);
  reachArm(p, 'R', -H.HALF_WIDTH, up, ahead, 1, elbowOut);
}

// Gripping it where it lies: leaning back, knees bent, the leading heel dug in ahead, the rear
// foot braced behind, trembling with the strain; glaring at it.
function tailHold(p, c) {
  const strain = Math.sin(c.time * 31) * 0.012;
  const heave = Math.sin(c.time * 3.2);
  p.rootZ = -4;
  p.hipsY = -11 + 1.5 * heave;
  p.hipsPitch = -0.16;
  p.hipsYaw = 0.12;
  p.spinePitch = -0.02 + strain;
  p.spineYaw = -0.1;
  plantLeg(p, 'L', 20);
  plantLeg(p, 'R', -16);
  p.ankleL -= 0.35; // toes up: the heel digs in
  p.legLSpread = 0.1;
  p.legRSpread = 0.12;
  p.headPitch = 0.12;
  p.headRoll = strain * 2;
  grip(p, H.HOLD_AHEAD, H.HOLD_UP);
  p.face = 'shout';
}

// Heaving it up (the hands rise with the haul), then spinning round on the spot: leaning back
// against the pull, quick little steps as he turns, looking up at the beast whirling overhead.
function tailSpin(p, c) {
  const e = smoothstep(0, RAISE_TIME, c.t);
  const ahead = H.HOLD_AHEAD + (H.SPIN_AHEAD - H.HOLD_AHEAD) * e;
  const up = H.HOLD_UP + (H.SPIN_UP - H.HOLD_UP) * e;
  const step = c.time * TAU * 2.4;
  const sL = Math.sin(step);
  const sR = Math.sin(step + Math.PI);
  p.rootZ = -6 - 4 * e;
  p.hipsY = -12 + 2 * Math.abs(sL);
  p.hipsPitch = -0.18 - 0.08 * (1 - e);
  p.spinePitch = -0.16 * e + 0.01 * Math.sin(c.time * 29);
  p.spineRoll = 0.05 * sL;
  plantLeg(p, 'L', 14 + 5 * sL, sL > 0 ? 7 * sL : 0);
  plantLeg(p, 'R', -12 + 5 * sR, sR > 0 ? 7 * sR : 0);
  p.legLSpread = 0.14;
  p.legRSpread = 0.14;
  p.headPitch = 0.1 - 0.5 * e;
  grip(p, ahead, up, 0.6);
  p.face = 'shout';
}

// Letting go: the arms fling up and out after it, the body pitching forward with the throw,
// then a triumphant fist and back to standing.
const THROW_KEYS = [
  [0, (q) => {
    q.rootZ = -8;
    q.hipsY = -12;
    q.hipsPitch = -0.2;
    q.spinePitch = -0.15;
    plantFeet(q, 14, -12);
    q.headPitch = -0.4;
    grip(q, H.SPIN_AHEAD, H.SPIN_UP, 0.6);
    q.face = 'shout';
  }],
  [0.14, (q) => {
    q.hipsY = -6;
    q.hipsPitch = 0.25;
    q.spinePitch = 0.2;
    plantFeet(q, 22, -18);
    arms(q, 2.3, 1.1, 0.1);
    q.headPitch = -0.2;
    q.face = 'shout';
  }],
  [0.42, (q) => {
    stand(q);
    q.hipsY = -3;
    q.spinePitch = -0.08;
    plantFeet(q, 10, -8);
    arm(q, 'R', 0.5, 1.9, 0.7);
    arm(q, 'L', -0.2, 0.5, 1.4, -0.6);
    q.headPitch = -0.3;
    q.face = 'happy';
  }],
  [0.73, (q) => {
    stand(q);
    plantFeet(q, 4, -3);
    q.headPitch = -0.2;
    q.face = 'happy';
  }],
];

function tailThrow(p, c) {
  keyframes(p, c.t, THROW_KEYS, c);
  // A little hop of effort as it goes.
  p.rootY += 10 * easeOut(unit(c.t / 0.1)) * (1 - unit((c.t - 0.1) / 0.2));
}

export const TAIL_ANIMS = {
  tail_hold: { pose: tailHold, blend: 0.1 },
  tail_spin: { pose: tailSpin, blend: 0.12 },
  tail_throw: { pose: tailThrow, blend: 0.05, blendOut: 0.15 },
};
