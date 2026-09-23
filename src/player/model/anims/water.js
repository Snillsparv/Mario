// Swimming poses. Underwater swim poses are already prone (body horizontal); the
// RenderState pitch adds the up/down swim angle on top. water_surface is upright treading.
// Timing uses animTime so the strokes keep going whatever the physics does with cyclePhase.

import { PI, TAU, smoothstep, hump, arm, arms, leg, legs } from '../kit.js';
import { STROKE_TIME } from '../physicsLink.js';

// Gentle treading: body tilted forward, hands sculling, lazy flutter.
function swimIdle(p, c) {
  const w = c.t * 3;
  p.flipPitch = 0.65;
  p.rootY = 2 * Math.sin(c.t * 1.5);
  for (const [side, o] of [['L', 0], ['R', PI]]) {
    arm(p, side, 0.6, 1.0 + 0.15 * Math.sin(w + o), 0.6, 0.35 * Math.sin(w));
  }
  leg(p, 'L', 0.1 + 0.25 * Math.sin(c.t * 3.5), 0.45, 0.5);
  leg(p, 'R', 0.1 - 0.25 * Math.sin(c.t * 3.5), 0.45, 0.5);
  p.headPitch = -0.55;
}

// Breaststroke: arms sweep from straight ahead out and back to the sides while the legs
// frog-kick, then everything folds in and reaches forward again. One stroke per physics
// stroke action (a re-stroke restarts the anim).
function swimStroke(p, c) {
  const u = (c.t % STROKE_TIME) / STROKE_TIME;
  const power = smoothstep(0, 0.4, u);
  const recover = smoothstep(0.4, 1, u);
  p.flipPitch = 1.35;
  p.headPitch = -1.1;
  const swing = u < 0.4 ? 2.9 - 2.4 * power : 0.5 + 2.4 * recover;
  const raise = u < 0.4 ? 0.25 + 1.1 * hump(power) : 0.3;
  const elbow = u < 0.4 ? 0.2 : 0.2 + 1.7 * hump(recover);
  arms(p, swing, raise, elbow);
  // Knees draw up during the recovery and snap straight during the power sweep.
  const draw = u < 0.4 ? 1 - power : recover;
  legs(p, -0.1 + 0.9 * draw, 0.2 + 1.7 * draw, 0.7 - 0.9 * draw, 0.15 + 0.45 * draw);
  p.rootY = -3 * hump(power);
  p.face = 'shout';
}

// Flutter kick: arms stretched ahead, legs alternating quickly.
function swimFlutter(p, c) {
  const w = c.t * TAU * 2.6;
  p.flipPitch = 1.4;
  p.headPitch = -1.1;
  arms(p, 2.75, 0.35, 0.2);
  p.armLRaise += 0.1 * Math.sin(w * 0.5);
  p.armRRaise -= 0.1 * Math.sin(w * 0.5);
  leg(p, 'L', -0.05 + 0.35 * Math.sin(w), 0.3 + 0.25 * Math.max(0, Math.cos(w)), 0.8);
  leg(p, 'R', -0.05 - 0.35 * Math.sin(w), 0.3 + 0.25 * Math.max(0, -Math.cos(w)), 0.8);
  p.hipsYaw = 0.05 * Math.sin(w);
}

// Head above the surface: arms sculling out to the sides, legs pedalling below.
function waterSurface(p, c) {
  const w = c.t * 3.2;
  p.rootY = 2 * Math.sin(c.t * 2);
  p.spinePitch = 0.1;
  p.headPitch = -0.1;
  arm(p, 'L', 0.35, 1.25, 0.5, 0.45 * Math.sin(w));
  arm(p, 'R', 0.35, 1.25, 0.5, 0.45 * Math.sin(w));
  leg(p, 'L', 0.5 + 0.4 * Math.sin(w), 1.0 + 0.6 * Math.cos(w), 0.4);
  leg(p, 'R', 0.5 - 0.4 * Math.sin(w), 1.0 - 0.6 * Math.cos(w), 0.4);
}

export const WATER_ANIMS = {
  swim_idle: { pose: swimIdle, blend: 0.25 },
  swim_stroke: { pose: swimStroke, blend: 0.12 },
  swim_flutter: { pose: swimFlutter, blend: 0.2 },
  water_surface: { pose: waterSurface, blend: 0.25 },
};
