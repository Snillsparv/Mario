// Pip and a wheelie bin (actions/bin.js): both mittens on its face (BIN_HANDS, in body space:
// a bin is as tall as he is, so on its body as high as his arms reach), squared up to it;
// pushing it ahead in short shoving steps, leaning in; pulling it after him walking backwards,
// leaning back as it tips toward him onto its wheels (objects/laneBoss/LaneBins.js tips the
// drawn bin as he pulls, by BIN_TIP over the same ease).

import { TAU, smoothstep, plantFeet, reachArm, arms } from '../kit.js';
import { gaitAt, gaitLegs } from '../gait.js';
import { BIN_HANDS as H } from '../../actions/bin.js';

// The bin's tip toward him while pulled (radians) and the ease it comes in over (s): its face,
// where his mittens are, comes nearer and a little lower by as much.
export const BIN_TIP = 0.26;
export const BIN_TIP_TIME = 0.2;
const PULL = { stance: 0.6, reach: 30, toeUp: 0.15, heelUp: 0.5, lift: 5, kick: 2, zMid: 2 };

// Both mittens on the face, `ahead` in front of his feet and `up` high.
function grip(p, ahead, up) {
  arms(p, 1.2, 0.25, 0.5); // (the IK's start: arms forward, elbows out)
  reachArm(p, 'L', H.HALF_WIDTH, up, ahead, 1, 0.45);
  reachArm(p, 'R', -H.HALF_WIDTH, up, ahead, 1, 0.45);
}

// Holding it still: leaning in a little to reach it, boots planted, breathing.
function binHold(p, c) {
  const b = Math.sin(c.time * 2.3);
  p.rootZ = 9;
  p.hipsY = -4 + 0.6 * b;
  p.hipsPitch = 0.05;
  p.spinePitch = 0.2 + 0.02 * b;
  plantFeet(p, -4, -12);
  p.legLSpread = p.legRSpread = 0.08;
  p.headPitch = -0.12;
  grip(p, H.AHEAD, H.UP);
}

// Pushing it ahead: short steps, leaning into it.
function binPush(p, c) {
  const w = c.t * TAU * 1.6;
  const s = Math.sin(w);
  p.rootZ = 11;
  p.rootY = -1.2 * Math.abs(Math.cos(w));
  p.hipsY = -6;
  p.hipsPitch = 0.12;
  p.spinePitch = 0.3;
  plantFeet(p, -6 + 7 * s, -14 - 7 * s);
  p.kneeL += 0.3 * Math.max(0, Math.cos(w));
  p.kneeR += 0.3 * Math.max(0, -Math.cos(w));
  p.headPitch = -0.2;
  grip(p, H.AHEAD, H.UP - 2);
  p.face = 'shout';
}

// Pulling it after him: walking backwards (the walk's legs run back), leaning back against its
// weight, heels first; his mittens follow its face as it tips toward him.
function binPull(p, c) {
  const e = smoothstep(0, BIN_TIP_TIME, c.t);
  const ph = 1 - (c.ph % 1);
  const w = ph * TAU;
  p.rootZ = -2;
  p.rootY = -1.2 * Math.cos(2 * w);
  p.hipsY = -5;
  p.hipsPitch = -0.12;
  p.spinePitch = -0.04;
  gaitLegs(p, ph, gaitAt(PULL, 100));
  p.headPitch = 0.04;
  const ahead = H.AHEAD - H.UP * Math.sin(BIN_TIP) * e;
  const up = H.UP - H.UP * (1 - Math.cos(BIN_TIP)) * e;
  grip(p, ahead, up);
}

export const BIN_ANIMS = {
  bin_hold: { pose: binHold, blend: 0.12 },
  bin_push: { pose: binPush, blend: 0.12 },
  bin_pull: { pose: binPull, blend: 0.12 },
};
