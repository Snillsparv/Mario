// Helpers shared by the action groups: jump selection, landing, ledge / pole grabs and
// locomotion animation bookkeeping.

import { PLAYER_HEIGHT } from '../../core/constants.js';
import * as T from '../physics/tuning.js';
import { isSlippery, isSteep } from '../physics/slopes.js';

// Single, double or triple jump depending on what was just landed from. A double jump
// needs no speed (hopping in place works); the triple needs a running start.
export function jumpFromGround(p) {
  const chain = p.tick - p.jumpChain.landedAt <= T.JUMP_CHAIN_WINDOW ? p.jumpChain.kind : null;
  if (chain === 'double' && p.forwardVel >= T.TRIPLE_JUMP_MIN_SPEED) return p.setAction('triple_jump');
  if (chain === 'single') return p.setAction('double_jump');
  return p.setAction('jump');
}

// Walking off a ledge keeps the momentum.
export function fallOff(p) {
  p.setAction('freefall');
  return false;
}

// Touch-down from the air: fall damage, landing events, jump-chain window, then the
// landing action. opts: { next = 'land', chain, ticks, safe (no fall damage), pound }.
// Fast landings from beyond HARD_FALL_HEIGHT hurt (more beyond BIG_FALL_HEIGHT) unless the
// landing is safe or a ground pound; a slippery floor turns the smaller of those falls into
// a harmless hard landing. Returns true (run the landing action now) when a button was
// pressed on the touchdown tick, so that press still counts (jump chains, punches, slides).
export function landFromAir(p, opts = {}) {
  const fall = p.peakY - p.pos.y;
  const fast = p.vel.y < -T.FALL_DAMAGE_MIN_VY;
  p.vel.y = 0;
  const surface = p.floor.surface;
  const safe = opts.safe || opts.pound;
  const hardFall = !safe && fast && fall > T.HARD_FALL_HEIGHT;
  const bigFall = fall > T.BIG_FALL_HEIGHT;
  const damage = !hardFall ? 0 : bigFall ? T.BIG_FALL_DAMAGE : isSlippery(p.floor) ? 0 : T.HARD_FALL_DAMAGE;
  const hard = !!opts.pound || hardFall;
  p.emit('land', { terrain: surface?.terrain ?? 'grass', pos: { ...p.pos }, hard });
  if (damage) {
    p.setAction('hard_fall');
    p.loseHealth(damage);
    return false;
  }
  p.jumpChain.kind = opts.chain ?? null;
  p.jumpChain.landedAt = p.tick;
  if (isSteep(p.floor) && opts.next !== 'belly_slide') {
    p.setAction('butt_slide');
    return false;
  }
  const next = opts.next ?? 'land';
  const ticks = hard ? Math.max(T.HARD_LAND_TICKS, opts.ticks ?? 0) : opts.ticks ?? T.LAND_TICKS;
  p.setAction(next, { ticks, hard });
  const c = p.input;
  return next === 'land' && !hard && (c.A.pressed || c.B.pressed || c.Z.pressed);
}

const LEDGE_PROBE_IN = 60; // ledge tops are probed this far past the hero's centre into the wall
const STAND_INSETS = [80, 65]; // candidate spots to climb onto, measured the same way
const STAND_CLEARANCE = 4; // a climb spot is free when its wall probes move it less than this

// Falling past a wall grabs its ledge when the top passes through arm's reach this tick
// (LEDGE_MIN_RISE..LEDGE_MAX_RISE above the feet). The top must be a flat floor where the
// wall really ends (no wall continuing above the lip, nothing solid over it), hanging must
// keep the feet above the ground, and there must be room to stand after climbing.
export function tryLedgeGrab(p, wall) {
  if (wall.pole || p.vel.y >= 0 || p.tick < p.grabCooldownUntil) return false;
  if (!facingWall(p, wall, 0.35)) return false;
  const col = p.collision;
  const hn = wall.hn;
  const lx = p.pos.x - hn.x * LEDGE_PROBE_IN;
  const lz = p.pos.z - hn.z * LEDGE_PROBE_IN;
  // This tick the feet fell from pos.y - vel.y to pos.y: the reach band swept that range.
  const top = col.findFloor(lx, p.pos.y + T.LEDGE_MAX_RISE - p.vel.y, lz, 0);
  if (!top.surface || top.surface.normal.y < 0.9) return false;
  if (top.y - p.pos.y < T.LEDGE_MIN_RISE) return false;
  if (top.y - T.HANG_DEPTH < p.floor.y + 10) return false;
  for (const w of col.findWalls(p.pos.x, top.y, p.pos.z, 30, 55).walls) {
    if (w.hn.x * hn.x + w.hn.z * hn.z > 0.3) return false;
  }
  if (col.findFloor(lx, top.y + PLAYER_HEIGHT, lz, 0).y > top.y + 1) return false;
  if (col.findCeil(lx, top.y + 80, lz).y - top.y < PLAYER_HEIGHT) return false;
  const climbTo = standSpot(p, hn, top.y);
  if (!climbTo) return false;
  p.setAction('ledge_hang', { y: top.y, hn: { x: hn.x, z: hn.z }, climbTo });
  return true;
}

// Where the hero ends up after climbing onto a ledge at height y, or null if nowhere fits.
function standSpot(p, hn, y) {
  const col = p.collision;
  for (const inset of STAND_INSETS) {
    const x = p.pos.x - hn.x * inset;
    const z = p.pos.z - hn.z * inset;
    const f = col.findFloor(x, y + 20, z);
    if (!f.surface || Math.abs(f.y - y) >= 30) continue;
    const knee = col.findWalls(x, f.y, z, 30, 50);
    const chest = col.findWalls(knee.x, f.y, knee.z, 60, 50);
    if (Math.hypot(chest.x - x, chest.z - z) >= STAND_CLEARANCE) continue;
    if (col.findCeil(x, f.y + 80, z).y - f.y < PLAYER_HEIGHT) continue;
    return { x, y: f.y, z };
  }
  return null;
}

// The climbable pole within the airborne hero's grabbing reach, or null.
export function poleInReach(p) {
  return p.collision.findPole(p.pos.x, p.pos.y + 60, p.pos.z, T.POLE_GRAB_REACH);
}

// Grabs `pole` (one in reach) unless grabs are on cooldown.
export function tryPoleGrab(p, pole) {
  if (p.tick < p.grabCooldownUntil) return false;
  p.setAction('pole', pole);
  return true;
}

// True when the facing points into the wall within ~cosLimit.
export function facingWall(p, wall, cosLimit) {
  return -(Math.sin(p.faceYaw) * wall.hn.x + Math.cos(p.faceYaw) * wall.hn.z) > cosLimit;
}

// Walk-cycle animation from the larger of stick intent and actual speed.
export function walkAnim(p) {
  const v = Math.max(p.intendedMag, p.forwardVel);
  return v < T.TIPTOE_SPEED ? 'tiptoe' : v < T.RUN_SPEED ? 'walk' : 'run';
}

// Advances the locomotion cycle proportionally to distance travelled.
export function advanceCycle(p, anim, speed = Math.abs(p.forwardVel)) {
  p.cyclePhase += speed / T.STRIDE[anim];
}
