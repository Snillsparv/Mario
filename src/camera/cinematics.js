// Scripted camera shots: the fly-in when play starts and the title-screen orbit.
// Pure functions of layout + time so they are easy to test and preview.

import { clamp, smoothstep } from '../core/math.js';
import { TITLE_PERIOD, TITLE_RADIUS, TITLE_SWEEP } from './cameraConfig.js';

// Ease-in-out with zero velocity and acceleration at both ends.
export function smootherstep(t) {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function bezier(p0, p1, p2, p3, t, out) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  out.x = a * p0.x + b * p1.x + c * p2.x + d * p3.x;
  out.y = a * p0.y + b * p1.y + c * p2.y + d * p3.y;
  out.z = a * p0.z + b * p1.z + c * p2.z + d * p3.z;
  return out;
}

// Control points of the fly-in: start high above the back of the castle, sweep over its
// front, curve down past the side of the hero's spawn and end at the live orbit position
// behind the hero (passed per tick, so the hand-off is seamless).
export function makeIntroPath(layout, spawn) {
  const C = layout.CASTLE;
  return {
    p0: { x: C.x - 1400, y: C.keepTopY + 1500, z: C.backZ - 1200 },
    p1: { x: C.x + 2800, y: C.keepTopY + 200, z: C.frontZ + 600 },
    p2: { x: spawn.x + 2600, y: spawn.y + 900, z: spawn.z - 900 },
    look0: { x: C.x, y: C.baseY + 500, z: (C.frontZ + spawn.z) / 2 },
  };
}

// Pose at progress t (0..1) given the live orbit pose to land on.
export function introPose(path, t, livePos, liveTarget, outPos, outTarget) {
  const s = smootherstep(t);
  bezier(path.p0, path.p1, path.p2, livePos, s, outPos);
  const k = smoothstep(0.1, 0.7, t);
  outTarget.x = path.look0.x + (liveTarget.x - path.look0.x) * k;
  outTarget.y = path.look0.y + (liveTarget.y - path.look0.y) * k;
  outTarget.z = path.look0.z + (liveTarget.z - path.look0.z) * k;
}

// Slow orbit around the castle for the title screen (timeSeconds -> pose). The camera
// sweeps back and forth over the front half of the circle, so the view always shows the
// facade and the lawn rather than the back wall and the rear cliff.
export function titleOrbitPose(layout, timeSeconds, outPos, outTarget) {
  const C = layout.CASTLE;
  const cz = (C.frontZ + C.backZ) / 2;
  const phase = (timeSeconds / TITLE_PERIOD) * Math.PI * 2;
  const a = TITLE_SWEEP * Math.sin(phase); // 0 = straight in front (south) of the castle
  outPos.x = C.x + Math.sin(a) * TITLE_RADIUS;
  outPos.z = cz + Math.cos(a) * TITLE_RADIUS;
  outPos.y = 2000 + 500 * Math.sin(phase * 1.5 + 0.8);
  outTarget.x = C.x;
  outTarget.y = C.baseY + 1100;
  outTarget.z = cz;
}
