// The cannon (objects/Cannon.js builds it; see CANNON_* in tuning.js). Two actions:
//
// 'cannon' (automatic; entered through player.enterCannon(cannon) when Pip steps onto the
// cannon's loading pad; `cannon` = { x, y, z: the barrel's pivot, muzzle: pivot -> muzzle
// mouth, restYaw, restPitch: the barrel's idle pose, exit: { x, y, z } where climbing out
// lands him }). Phases (p.cannon.phase):
//   hop     a scripted leap from the pad over the breech, diving head first into the muzzle
//           (anim 'triple_jump', then 'dive' tipped nose down); sfx 'cannon_enter' as he drops in
//   settle  inside (the camera hides him): the barrel lowers from its rest pitch to
//           CANNON_START_PITCH; input waits
//   aim     the stick turns the barrel (p.cannon.yaw / pitch: yaw all round, pitch clamped;
//           the stick's square, so a small push aims finely), sfx 'cannon_turn' every
//           CANNON_CLICK_ANGLE of turning; A fires ('cannon_shot'); B or Z unloads
//   unload  the barrel swings back to its rest pose, then he climbs out:
//   out     a scripted hop from the muzzle down to cannon.exit, then an ordinary landing
// While inside (settle, aim, unload: p.cannon.inside) he is immune to damage and his feet are
// parked in the turret under the pivot.
//
// 'cannon_shot' (airborne, anim 'cannon_shot'): out of the muzzle at CANNON_SPEED along the
// barrel ('cannonFire' { pos, yaw, pitch, dir } and sfx 'cannon_fire' + 'cannon_whoosh'),
// then a ballistic arc under CANNON_GRAVITY (terminal speed TERMINAL_VY), sub-stepped so no
// sub-step moves further than CANNON_SUB_STEP (walls, floors, ceilings and trunks are never
// tunnelled through). He grabs ledges (falling) and trunks, slides along grazing walls, bonks
// softly off walls met head-on (soft_bonk) and off the level's perimeter (held
// CANNON_EDGE_MARGIN inside it, above the cliffs too), lands on his feet with at most
// CANNON_LAND_MAX_SPEED (a hard landing's squat, never fall damage: p.flightFall covers every
// fall that follows too, and p.cannonSafeUntil the slide off a steep roof he lands on). From CANNON_CONTROL_TICKS in, Z ground-pounds and B dives. With the
// winged hat on, the shot takes off into flight at its peak (flying, { apex, cannon }: the
// flight keeps up to CANNON_FLY_MAX_SPEED of its speed). RenderState pitch follows the arc.

import { approach, approachAngle, clamp, lerp, smoothstep, wrapAngle } from '../../core/math.js';
import { PERIMETER, sdRoundRect } from '../../world/layout.js';
import * as T from '../physics/tuning.js';
import { airStep, STEP_LANDED } from '../physics/step.js';
import { isSteep } from '../physics/slopes.js';
import { facingWall, landFromAir, poleInReach, tryLedgeGrab, tryPoleGrab } from './common.js';

const BELLY = 78; // the body's tilt pivot above the feet (model dims CENTER): at the mouth when shot
const MOUTH_OUT = 25; // the shot starts with the belly this far out of the mouth
const PARK_BELOW = 110; // while inside, the feet wait this far under the pivot
const DIVE_FROM = 0.55; // share of the hop after which he dives head first at the mouth
const HEAD_ON_COS = T.FLY_BONK_COS;

// Unit barrel direction for yaw / pitch (pitch > 0 = up), into `out`.
export function barrelDir(yaw, pitch, out = { x: 0, y: 0, z: 0 }) {
  const cp = Math.cos(pitch);
  out.x = Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = Math.cos(yaw) * cp;
  return out;
}

// The muzzle mouth's centre for a cannon descriptor at yaw / pitch, into `out`.
export function muzzlePoint(cannon, yaw, pitch, out = { x: 0, y: 0, z: 0 }) {
  barrelDir(yaw, pitch, out);
  out.x = cannon.x + out.x * cannon.muzzle;
  out.y = cannon.y + out.y * cannon.muzzle;
  out.z = cannon.z + out.z * cannon.muzzle;
  return out;
}

const mouth = { x: 0, y: 0, z: 0 };
const dir = { x: 0, y: 0, z: 0 };

// No interpolation from the previous tick's placement (into or out of the barrel).
function snapRender(p) {
  p.prevPos.x = p.pos.x;
  p.prevPos.y = p.pos.y;
  p.prevPos.z = p.pos.z;
}

function park(p, s) {
  const c = s.desc;
  p.pos.x = c.x;
  p.pos.y = c.y - PARK_BELOW;
  p.pos.z = c.z;
  p.vel.x = p.vel.y = p.vel.z = 0;
  p.forwardVel = 0;
  p.faceYaw = s.yaw;
}

// Moves the feet to (x, y, z) along a scripted path; the velocity is the step taken (the camera
// and the scarf read it).
function moveTo(p, x, y, z) {
  p.vel.x = x - p.pos.x;
  p.vel.y = y - p.pos.y;
  p.vel.z = z - p.pos.z;
  p.forwardVel = Math.hypot(p.vel.x, p.vel.z);
  p.pos.x = x;
  p.pos.y = y;
  p.pos.z = z;
}

// A parabolic leap from `a` to `b` (feet), topping out `rise` over the higher end; u 0..1.
function arcAt(a, b, u, rise, out) {
  const top = Math.max(a.y, b.y) + rise;
  // y = a + (b - a) u + 4 h u (1 - u) with h chosen so the peak reaches `top`: solved for the
  // symmetric part (close enough for these short hops).
  const h = top - (a.y + b.y) / 2;
  out.x = lerp(a.x, b.x, u);
  out.z = lerp(a.z, b.z, u);
  out.y = lerp(a.y, b.y, u) + 4 * h * u * (1 - u);
  return out;
}

const pt = { x: 0, y: 0, z: 0 };

function hop(p, s) {
  const N = T.CANNON_HOP_TICKS;
  const u = Math.min(1, s.t / N);
  const c = s.desc;
  muzzlePoint(c, s.yaw, s.pitch, mouth);
  mouth.y -= BELLY; // (the feet, with the belly at the mouth)
  arcAt(s.from, mouth, u, T.CANNON_HOP_RISE, pt);
  moveTo(p, pt.x, pt.y, pt.z);
  if (u >= DIVE_FROM) {
    // Head first into the mouth: flat out, tipped nose down toward it.
    p.setAnim('dive');
    p.pitch = lerp(0.2, 1.35, smoothstep(DIVE_FROM, 1, u));
  }
  if (u < 1) return false;
  s.phase = 'settle';
  s.t = 0;
  s.inside = true;
  park(p, s);
  snapRender(p);
  p.setAnim('crouch');
  p.sfx('cannon_enter');
  return false;
}

function settle(p, s) {
  const k = smoothstep(0, T.CANNON_SETTLE_TICKS, s.t);
  s.pitch = lerp(s.desc.restPitch, T.CANNON_START_PITCH, k);
  park(p, s);
  if (s.t >= T.CANNON_SETTLE_TICKS) {
    s.phase = 'aim';
    s.t = 0;
  }
  return false;
}

function aim(p, s, c) {
  // (A button held since the settle is no fresh press: `pressed` is only its edge.)
  if (c.A.pressed) return p.setAction('cannon_shot');
  if (c.B.pressed || c.Z.pressed) {
    s.phase = 'unload';
    s.t = 0;
    p.sfx('cannon_turn');
    park(p, s);
    return false;
  }
  const sx = c.stickX;
  const sy = c.stickY;
  const yaw = wrapAngle(s.yaw - sx * Math.abs(sx) * T.CANNON_YAW_RATE);
  const pitch = clamp(s.pitch + sy * Math.abs(sy) * T.CANNON_PITCH_RATE, T.CANNON_MIN_PITCH, T.CANNON_MAX_PITCH);
  turned(p, s, yaw, pitch);
  park(p, s);
  return false;
}

// Sets the aim and clicks the ratchet every CANNON_CLICK_ANGLE of turning.
function turned(p, s, yaw, pitch) {
  const d = Math.abs(wrapAngle(yaw - s.yaw)) + Math.abs(pitch - s.pitch);
  s.yaw = yaw;
  s.pitch = pitch;
  s.turn += d;
  if (d > 0 && s.turn >= T.CANNON_CLICK_ANGLE) {
    s.turn %= T.CANNON_CLICK_ANGLE;
    p.sfx('cannon_turn');
  }
}

function unload(p, s) {
  const r = T.CANNON_UNLOAD_RATE;
  const c = s.desc;
  turned(p, s, approachAngle(s.yaw, c.restYaw, r), approach(s.pitch, c.restPitch, r));
  park(p, s);
  if (s.yaw !== c.restYaw || s.pitch !== c.restPitch) return false;
  // Out of the mouth, over the breech, down beside the pad.
  s.phase = 'out';
  s.t = 0;
  s.inside = false;
  muzzlePoint(c, s.yaw, s.pitch, mouth);
  p.pos.x = mouth.x;
  p.pos.y = mouth.y - BELLY * 0.5;
  p.pos.z = mouth.z;
  snapRender(p);
  s.from = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
  const e = c.exit;
  const f = p.collision.findFloor(e.x, e.y + 200, e.z);
  s.to = { x: e.x, y: f.surface ? f.y : e.y, z: e.z };
  p.faceYaw = Math.atan2(s.to.x - s.from.x, s.to.z - s.from.z);
  p.setAnim('double_jump', true);
  p.sfx('jump');
  return false;
}

function out(p, s) {
  const u = Math.min(1, s.t / T.CANNON_OUT_TICKS);
  arcAt(s.from, s.to, u, 120, pt);
  moveTo(p, pt.x, pt.y, pt.z);
  if (u > 0.6) p.setAnim('fall');
  if (u < 1) return false;
  p.floor = p.collision.findFloor(p.pos.x, p.pos.y + 20, p.pos.z);
  if (p.floor.surface) p.pos.y = p.floor.y;
  p.grounded = !!p.floor.surface;
  p.forwardVel = 0;
  p.vel.x = p.vel.z = 0;
  p.vel.y = -20;
  p.peakY = p.pos.y;
  if (!p.grounded) {
    p.setAction('freefall');
    return false;
  }
  return landFromAir(p, {});
}

const cannon = {
  group: 'automatic',
  anim: 'triple_jump',
  // arg: the cannon descriptor (see top).
  enter(p, desc) {
    p.cannon = {
      desc,
      phase: 'hop',
      t: 0,
      yaw: desc.restYaw,
      pitch: desc.restPitch,
      turn: 0,
      inside: false,
      from: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
      to: null,
    };
    p.vel.x = p.vel.y = p.vel.z = 0;
    p.forwardVel = 0;
    p.airDrift = 0;
    p.grounded = false;
    p.comboJump = null;
    muzzlePoint(desc, desc.restYaw, desc.restPitch, mouth);
    const dx = mouth.x - p.pos.x;
    const dz = mouth.z - p.pos.z;
    if (dx * dx + dz * dz > 1) p.faceYaw = Math.atan2(dx, dz);
    p.sfx('triple_jump');
  },
  update(p, c) {
    const s = p.cannon;
    s.t++;
    switch (s.phase) {
      case 'hop':
        return hop(p, s);
      case 'settle':
        return settle(p, s);
      case 'aim':
        return aim(p, s, c);
      case 'unload':
        return unload(p, s);
      default:
        return out(p, s);
    }
  },
};

// ------------------------------------------------------------------ the shot

// Keeps the shot CANNON_EDGE_MARGIN inside the level's perimeter (the outward velocity is
// dropped and he faces the barrier). Returns true when it held him.
function holdInside(p) {
  const x = p.pos.x;
  const z = p.pos.z;
  const d = sdRoundRect(x, z, PERIMETER) + T.CANNON_EDGE_MARGIN;
  if (d <= 0) return false;
  const e = 5;
  let gx = sdRoundRect(x + e, z, PERIMETER) - sdRoundRect(x - e, z, PERIMETER);
  let gz = sdRoundRect(x, z + e, PERIMETER) - sdRoundRect(x, z - e, PERIMETER);
  const g = Math.hypot(gx, gz) || 1;
  gx /= g;
  gz /= g;
  p.pos.x -= gx * d;
  p.pos.z -= gz * d;
  const outward = p.vel.x * gx + p.vel.z * gz;
  if (outward > 0) {
    p.vel.x -= gx * outward;
    p.vel.z -= gz * outward;
  }
  p.faceYaw = Math.atan2(gx, gz);
  return true;
}

// Touch-down: on the feet with at most CANNON_LAND_MAX_SPEED, a hard landing's squat, no damage.
// On a roof too steep to stand on (a tower's cone) he slides off it: falls in the next
// CANNON_SLIDE_GRACE ticks are part of this landing and never hurt either (common.js); on any
// other, a stumble off its edge (a battlement's top) within CANNON_LAND_GRACE ticks is too.
function landShot(p) {
  p.cannonSafeUntil = p.tick + (isSteep(p.floor) ? T.CANNON_SLIDE_GRACE : T.CANNON_LAND_GRACE);
  const h = Math.hypot(p.vel.x, p.vel.z);
  if (h > 1) p.faceYaw = Math.atan2(p.vel.x, p.vel.z);
  const fv = Math.min(h, T.CANNON_LAND_MAX_SPEED);
  p.forwardVel = fv;
  p.vel.x = fv * Math.sin(p.faceYaw);
  p.vel.z = fv * Math.cos(p.faceYaw);
  return landFromAir(p, { pound: true });
}

// A soft bonk off a wall (or the perimeter), keeping the downward speed.
function bonk(p) {
  p.forwardVel = Math.hypot(p.vel.x, p.vel.z);
  p.setAction('soft_bonk');
  return false;
}

const cannonShot = {
  group: 'airborne',
  anim: 'cannon_shot',
  enter(p) {
    const s = p.cannon;
    const c = s?.desc;
    const yaw = s ? s.yaw : p.faceYaw;
    const pitch = s ? s.pitch : T.CANNON_START_PITCH;
    barrelDir(yaw, pitch, dir);
    if (c) {
      muzzlePoint(c, yaw, pitch, mouth);
      p.pos.x = mouth.x + dir.x * MOUTH_OUT;
      p.pos.y = mouth.y + dir.y * MOUTH_OUT - BELLY;
      p.pos.z = mouth.z + dir.z * MOUTH_OUT;
      snapRender(p);
      s.phase = 'fired';
      s.inside = false;
    } else {
      mouth.x = p.pos.x;
      mouth.y = p.pos.y + BELLY;
      mouth.z = p.pos.z;
    }
    const v = T.CANNON_SPEED;
    p.vel.x = dir.x * v;
    p.vel.y = dir.y * v;
    p.vel.z = dir.z * v;
    p.faceYaw = yaw;
    p.forwardVel = Math.hypot(p.vel.x, p.vel.z);
    p.airDrift = 0;
    p.grounded = false;
    p.walkOff = null;
    p.letGoPole = null;
    p.comboJump = null;
    p.flightFall = true; // no fall damage from here until he lands (Player.afterTick)
    p.peakY = p.pos.y;
    p.fallCeiling = Infinity;
    p.pitch = p.prevPitch = -pitch;
    p.emit('cannonFire', { pos: { x: mouth.x, y: mouth.y, z: mouth.z }, yaw, pitch, dir: { x: dir.x, y: dir.y, z: dir.z } });
    p.emit('sfx', { name: 'cannon_fire', pos: { x: mouth.x, y: mouth.y, z: mouth.z } });
    p.emit('sfx', { name: 'cannon_whoosh' }); // (it goes with him: not left behind at the muzzle)
  },
  update(p, c) {
    // With the winged hat, the peak of the arc takes off into flight (keeping its speed).
    if (p.wingHat > 0 && p.actionTimer > 0 && p.vel.y <= T.FLY_APEX_VY) {
      p.forwardVel = Math.hypot(p.vel.x, p.vel.z);
      return p.setAction('flying', { apex: true, cannon: true });
    }
    if (p.actionTimer >= T.CANNON_CONTROL_TICKS) {
      if (c.Z.pressed) return p.setAction('ground_pound');
      if (c.B.pressed) {
        p.forwardVel = Math.hypot(p.vel.x, p.vel.z);
        return p.setAction('dive');
      }
    }
    const speed = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
    const n = clamp(Math.ceil(speed / T.CANNON_SUB_STEP), 4, T.CANNON_MAX_SUB_STEPS);
    const r = airStep(p, n);
    if (r.result === STEP_LANDED) return landShot(p);
    if (holdInside(p)) return bonk(p);
    const w = r.wall;
    if (w && p.vel.y < 0 && tryLedgeGrab(p, w)) return false;
    const trunk = poleInReach(p, w);
    if (trunk !== p.letGoPole) p.letGoPole = null;
    if (trunk && tryPoleGrab(p, trunk)) return false;
    if (r.blocked || (w && !w.pole && facingWall(p, w, HEAD_ON_COS))) return bonk(p);
    if (w) {
      // Grazing a wall (or a trunk's side): slide along it.
      const into = p.vel.x * w.hn.x + p.vel.z * w.hn.z;
      if (into < 0) {
        p.vel.x -= w.hn.x * into;
        p.vel.z -= w.hn.z * into;
      }
    }
    p.vel.y = Math.max(p.vel.y - T.CANNON_GRAVITY, T.TERMINAL_VY);
    const h = Math.hypot(p.vel.x, p.vel.z);
    if (h > 1) p.faceYaw = Math.atan2(p.vel.x, p.vel.z);
    p.forwardVel = h;
    // Body along the arc (pitch > 0 = nose down).
    p.pitch = Math.atan2(-p.vel.y, Math.max(h, 1));
    return false;
  },
};

export const CANNON_ACTIONS = { cannon, cannon_shot: cannonShot };
