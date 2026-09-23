// Angle conventions: yaw is in radians. yaw = 0 faces +Z, and the forward vector for a yaw
// is (sin(yaw), 0, cos(yaw)). This matches THREE's Object3D.rotation.y for a model whose
// front faces +Z.

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Wrap an angle to (-PI, PI].
export function wrapAngle(a) {
  a = a % TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

// Shortest signed difference to go from angle a to angle b.
export function angleDiff(a, b) {
  return wrapAngle(b - a);
}

export function lerpAngle(a, b, t) {
  return a + angleDiff(a, b) * t;
}

// Move cur toward target by at most step (all radians), taking the short way around.
export function approachAngle(cur, target, step) {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= step) return target;
  return wrapAngle(cur + Math.sign(d) * step);
}

// Move cur toward target, increasing by at most inc and decreasing by at most dec.
export function approach(cur, target, inc, dec = inc) {
  if (cur < target) return Math.min(cur + inc, target);
  return Math.max(cur - dec, target);
}

export function yawFromVector(x, z) {
  return Math.atan2(x, z);
}

export function forwardFromYaw(yaw) {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

// Convert an analog stick direction into a world yaw, given the camera's look yaw
// (the yaw of the direction the camera faces). Stick up (+Y) moves away from the camera,
// stick right (+X) moves to the camera's right.
export function stickToWorldYaw(stickX, stickY, cameraYaw) {
  return wrapAngle(cameraYaw - Math.atan2(stickX, stickY));
}

// Deterministic small PRNG for procedural content (mulberry32).
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
