// Foot-planted locomotion. Each leg alternates a stance, where its boot rolls heel-to-toe
// on one fixed spot of ground while the body passes over it, and a swing, where it lifts
// and reaches forward for the next step. Driven by the gait phase (1.0 = one full cycle,
// over which the body covers `stride` units), so a planted boot never skates as long as
// the gait's stride matches the distance travelled (see animator.js).
//
// Gait params: { stance (largest fraction of the cycle a foot is down), reach (most ground
// a planted foot covers), toeUp (heel-strike angle), heelUp (toe-off angle), tiptoe (stay
// on the toes), lift, kick (heel kick-back early in the swing), drive (knee drive late in
// the swing), zMid (centre of the stance, forward of the body origin) }. The stride comes
// from strides.js; once stance x stride would exceed the reach, the stance shortens and
// the gait gains a flight phase (a jog, then a bounding run).

import { easeInOut, legTo, smoothstep } from './kit.js';
import { ANKLE_Y } from './dims.js';

// Rocker contact points on the sole's underside, relative to the ankle.
const HEEL_Z = -7;
const TOE_Z = 16;
const FOOT = TOE_Z - HEEL_Z;
const HEEL_STRIKE_END = 0.15; // stance fraction spent rolling off the heel
const TOE_OFF_START = 0.55; // stance fraction when the heel starts to lift

// The foot solutions below write into scratch records (read them right away), so a frame
// of walking creates no objects.
const off = { z: 0, y: 0 };
const footA = { z: 0, y: 0, pitch: 0 };
const footB = { z: 0, y: 0, pitch: 0 };

// Ankle offset from the heel contact with the toes raised by a (radians), into `off`.
function offHeel(a) {
  off.z = -HEEL_Z * Math.cos(a) - ANKLE_Y * Math.sin(a);
  off.y = -HEEL_Z * Math.sin(a) + ANKLE_Y * Math.cos(a);
  return off;
}
// Ankle offset from the toe contact with the heel raised by a, into `off`.
function offToe(a) {
  off.z = -TOE_Z * Math.cos(a) + ANKLE_Y * Math.sin(a);
  off.y = TOE_Z * Math.sin(a) + ANKLE_Y * Math.cos(a);
  return off;
}

// Ankle position and boot pitch (+ = toes down) at stance progress k, with the heel's
// ground contact at h0 (body z) when the stance begins; written into `out`.
function stanceFoot(g, k, h0, out) {
  const heel = h0 - g.stance * g.stride * k; // the ground slides back under the body
  let o;
  if (g.tiptoe) {
    o = offToe(g.heelUp);
    out.z = heel + FOOT + o.z;
    out.pitch = g.heelUp;
  } else if (k < HEEL_STRIKE_END) {
    const a = g.toeUp * (1 - smoothstep(0, HEEL_STRIKE_END, k));
    o = offHeel(a);
    out.z = heel + o.z;
    out.pitch = -a;
  } else {
    const a = g.heelUp * smoothstep(TOE_OFF_START, 1, k);
    o = offToe(a);
    out.z = heel + FOOT + o.z;
    out.pitch = a;
  }
  out.y = o.y;
  return out;
}

// Heel contact at the start of the stance, placing the stance's ankle range around zMid.
function heelStart(g) {
  const on = g.tiptoe ? FOOT + offToe(g.heelUp).z : offHeel(g.toeUp).z;
  const lift = FOOT + offToe(g.heelUp).z - g.stance * g.stride;
  return g.zMid - (on + lift) / 2;
}

// Poses one leg for leg phase u (0 = heel strike).
function gaitLeg(p, side, u, g) {
  u -= Math.floor(u);
  const h0 = heelStart(g);
  if (u < g.stance) {
    const f = stanceFoot(g, u / g.stance, h0, footA);
    legTo(p, side, f.z, f.y, f.pitch);
    return;
  }
  // Swing: from toe-off to the next heel strike, lifted in an arc. The boot leaves and
  // meets the floor moving back at ground speed (no scuff at either end), so it first
  // carries on behind, then reaches past the landing spot and paws back onto it. `kick`
  // flicks the heel up behind (toes pointing down), `drive` lifts the knee in front.
  const k = (u - g.stance) / (1 - g.stance);
  const a = stanceFoot(g, 1, h0, footA);
  const b = stanceFoot(g, 0, h0, footB);
  const arc = Math.sin(Math.PI * k);
  const e = easeInOut(k);
  const ground = g.stride * (1 - g.stance); // ground passing under the body per unit of k
  const z = a.z + (b.z - a.z) * k * k * (3 - 2 * k) - ground * k * (2 * k - 1) * (k - 1);
  const y = a.y + (b.y - a.y) * k + g.lift * arc + g.kick * arc * (1 - k) + g.drive * arc * k;
  legTo(p, side, z, y, a.pitch + (b.pitch - a.pitch) * e + 0.03 * g.kick * arc);
}

// The gait's params for a stride length, in a shared scratch record (use it right away).
// Every field is written each call: a gait that leaves one out (walk has no `tiptoe` or
// `drive`) must not inherit it from the gait posed before it.
const current = {
  stance: 0, reach: 0, toeUp: 0, heelUp: 0, tiptoe: false, lift: 0, kick: 0, drive: 0, zMid: 0, stride: 0,
};
export function gaitAt(g, stride) {
  current.stance = Math.min(g.stance, g.reach / stride);
  current.reach = g.reach;
  current.toeUp = g.toeUp ?? 0;
  current.heelUp = g.heelUp ?? 0;
  current.tiptoe = !!g.tiptoe;
  current.lift = g.lift ?? 0;
  current.kick = g.kick ?? 0;
  current.drive = g.drive ?? 0;
  current.zMid = g.zMid ?? 0;
  current.stride = stride;
  return current;
}

// Both legs half a cycle apart; `ph` is the gait phase (left heel strike at 0) and `g` a
// gait from gaitAt().
export function gaitLegs(p, ph, g) {
  gaitLeg(p, 'L', ph, g);
  gaitLeg(p, 'R', ph + 0.5, g);
}
