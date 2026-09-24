// How far Pip's body travels per locomotion cycle (two steps) for each gait, by speed.
// Pip's legs are short, so the stride is capped by how much ground a planted foot can
// cover; faster gaits add a flight phase instead (see gait.js). Walk and run keep a steady
// cadence (cycles per second) across their speed range, so switching anims never changes
// the leg rate abruptly.
//
// Kept free of three.js so the physics can share it: if the Player advances cyclePhase by
// speed / gaitStride(anim, speed), its footstep events land exactly on heel strikes.

import { FPS } from '../../core/constants.js';

// cadence: cycles per second the stride is sized for; min/max: stride limits (units).
const STRIDES = {
  walk: { cadence: 4.5, min: 80, max: 120 },
  run: { cadence: 4, min: 90, max: 280 }, // 240 at the full-stick speed of 32 u/tick
  tiptoe: { cadence: 0, min: 48, max: 48 },
  crawl: { cadence: 0, min: 44, max: 44 },
};

// Stride length (units per cycle) of a gait anim at `speed` (units/tick); 0 for other anims.
export function gaitStride(anim, speed) {
  const s = STRIDES[anim];
  if (!s) return 0;
  const want = s.cadence > 0 ? (Math.abs(speed) * FPS) / s.cadence : s.min;
  return Math.min(s.max, Math.max(s.min, want));
}
