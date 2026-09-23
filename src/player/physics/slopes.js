// Surface classes and slope helpers. A floor is "steep" for its class when the hero can't
// stand or walk up it and starts sliding; walking pull, skid braking, slide acceleration and
// slide friction also depend on the class.

import { smoothstep } from '../../core/math.js';
import { STEEP_WALK_ACCEL } from './tuning.js';

const DEG = Math.PI / 180;

// steepDeg: steepest walkable angle. walkPull: along-slope speed change per tick per unit of
// the normal's horizontal length while walking; it fades in between GENTLE_FROM and
// GENTLE_TO of steepDeg, so gentle slopes don't affect running speed at all.
// skidDecel: braking per tick during skids. slideAccel / slideLoss: slide physics.
const CLASSES = {
  very_slippery: { steepDeg: 10, walkPull: 5, skidDecel: 0.5, slideAccel: 10, slideLoss: 0.98 },
  slippery: { steepDeg: 20, walkPull: 2.8, skidDecel: 1.5, slideAccel: 8, slideLoss: 0.96 },
  default: { steepDeg: 38, walkPull: 1.9, skidDecel: 4, slideAccel: 7, slideLoss: 0.92 },
  not_slippery: { steepDeg: 70, walkPull: 0.8, skidDecel: 4, slideAccel: 5, slideLoss: 0.92 },
};
const GENTLE_FROM = 0.4;
const GENTLE_TO = 0.6;

export const SURFACE_CLASSES = Object.fromEntries(
  Object.entries(CLASSES).map(([name, c]) => [
    name,
    {
      ...c,
      steepNy: Math.cos(c.steepDeg * DEG),
      gentleFrom: c.steepDeg * GENTLE_FROM * DEG,
      gentleTo: c.steepDeg * GENTLE_TO * DEG,
    },
  ]),
);

export const UP = Object.freeze({ x: 0, y: 1, z: 0 });

export function surfaceClass(surface) {
  return SURFACE_CLASSES[surface?.surface] ?? SURFACE_CLASSES.default;
}

export function floorNormal(floor) {
  return floor.surface ? floor.surface.normal : UP;
}

export function isSteep(floor) {
  const s = floor.surface;
  return !!s && s.normal.y < surfaceClass(s).steepNy;
}

// True for floors that cushion falls (slippery / very slippery).
export function isSlippery(floor) {
  const kind = floor.surface?.surface;
  return kind === 'slippery' || kind === 'very_slippery';
}

// Horizontal part of the floor normal along the facing direction: > 0 when facing downhill.
export function slopeAlong(floor, yaw) {
  const n = floorNormal(floor);
  return Math.sin(yaw) * n.x + Math.cos(yaw) * n.z;
}

// Speed change per tick for a walker facing `yaw`: > 0 downhill, < 0 uphill, 0 on gentle slopes.
export function walkSlopeAccel(floor, yaw) {
  const s = floor.surface;
  if (!s) return 0;
  const cls = surfaceClass(s);
  const k = isSteep(floor) ? STEEP_WALK_ACCEL : cls.walkPull * smoothstep(cls.gentleFrom, cls.gentleTo, Math.acos(Math.min(1, s.normal.y)));
  return k * slopeAlong(floor, yaw);
}

// Skid braking per tick on the current floor.
export function skidDecel(floor) {
  return surfaceClass(floor.surface).skidDecel;
}

// Body pitch (> 0 nose down) and roll (> 0 right side down) that align the hero with the floor.
export function alignToFloor(floor, yaw, out) {
  const n = floorNormal(floor);
  const fwd = Math.sin(yaw) * n.x + Math.cos(yaw) * n.z;
  const right = -Math.cos(yaw) * n.x + Math.sin(yaw) * n.z;
  out.pitch = Math.atan2(fwd, n.y);
  out.roll = Math.atan2(right, n.y);
}
