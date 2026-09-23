// Collision stepping in the classic N64 style: each tick's motion is split into four
// quarter steps; walls are resolved by pushing probe points out horizontally, floors and
// ceilings by vertical queries. Steps write the hero's pos / floor / grounded directly.

import { NO_WATER, PLAYER_HEIGHT } from '../../core/constants.js';
import { POLE_BODY, SURFACE_FLOAT_DEPTH } from './tuning.js';
import { isSteep } from './slopes.js';
import { WALL_EDGE_MARGIN, wallContains } from '../../collision/CollisionWorld.js';

export const STEP_NONE = 'none';
export const STEP_HIT_WALL = 'hit_wall';
export const STEP_LEFT_GROUND = 'left_ground';
export const STEP_LANDED = 'landed';
const STEP_BLOCKED = 'blocked'; // internal: no room at the spot ahead, nothing committed

const MAX_STEP_DOWN = 100; // larger drops while walking mean we walked off a ledge
const CEIL_PROBE = 80; // ceilings are searched from floor + this (ignores a platform's own underside)
const BEHIND_EPS = 1; // tolerance for "the mover started behind this wall's plane"
const ENGAGE_MARGIN = 25; // a wall's back counts as in contact up to radius + this (one fast quarter step)

// Shared result object: { result, wall (the most relevant wall touched), hitCeiling, ... }.
function makeResult() {
  return { result: STEP_NONE, wall: null, hitCeiling: false, atSurface: false, onFloor: false, noWater: false };
}

function resetResult(r) {
  r.result = STEP_NONE;
  r.wall = null;
  r.hitCeiling = false;
  r.atSurface = false;
  r.onFloor = false;
  r.noWater = false;
  return r;
}

const groundRes = makeResult();
const airRes = makeResult();
const waterRes = makeResult();

function lastWall(w, fallback) {
  return w.walls.length ? w.walls[w.walls.length - 1] : fallback;
}

// Horizontal signed distance from a wall's plane at probe height py (> 0 in front of it).
function wallOffset(s, x, py, z) {
  const n = s.normal;
  return (n.x * x + n.y * py + n.z * z + s.d) / Math.hypot(n.x, n.z);
}

// Whether the point lies within wall s's extent (see CollisionWorld.wallContains).
const withinWall = wallContains;

// True when the mover at `from` was already pressed against the back of wall s: within reach
// of its plane, with the probe inside the wall's height range and extent.
function engagedBehind(s, from, offsetY, radius) {
  const py = from.y + offsetY;
  if (py < s.minY || py > s.maxY) return false;
  const off = wallOffset(s, from.x, py, from.z);
  return off >= -radius - ENGAGE_MARGIN && withinWall(s, from.x, py, from.z, radius * WALL_EDGE_MARGIN);
}

// The first other wall between the point (at probe height py) and wall s's plane, or null.
// If the point is in front of it, that wall separates the point from s.
function wallBetween(col, s, from, py) {
  const dist = -wallOffset(s, from.x, py, from.z);
  const hit = col.raycast({ x: from.x, y: py, z: from.z }, { x: s.hn.x, y: 0, z: s.hn.z }, dist, { floors: false, ceilings: false });
  return hit && hit.surface !== s && hit.distance < dist - BEHIND_EPS ? hit.surface : null;
}

// For a probe that sank into a solid through wall s's back: the face of that solid nearest
// behind the probe the other way, when closer than s (the smaller way out), else null.
function nearerExit(col, s, x, py, z, radius) {
  const depth = Math.min(-wallOffset(s, x, py, z), radius);
  const hit = col.raycast({ x, y: py, z }, { x: -s.hn.x, y: 0, z: -s.hn.z }, depth, { floors: false, ceilings: false });
  return hit && hit.surface !== s && wallOffset(hit.surface, x, py, z) < 0 ? hit.surface : null;
}

// Pushes the probe (x, y + offsetY, z) out of the walls within `radius`. Walls the mover
// started behind (at `from`, the start of the step) need care, as pushing out of their front
// would pull him through thin or double-sided geometry:
//  - coming from outside a solid (in front of another wall touched now), they are ignored;
//  - with another wall facing him between him and one, he is outside too and that nearer wall
//    (whose own push the far one's may have masked in findWalls) is resolved instead;
//  - already against one's back (a lone one-sided wall), it is ignored;
//  - otherwise he sank into the solid from above (dropping onto a topless fence slab or
//    post): he is ejected through its nearest face instead of being left standing inside.
function pushOutOfWalls(col, from, x, y, z, offsetY, radius) {
  const w = col.findWalls(x, y, z, offsetY, radius);
  const py = y + offsetY;
  const behind = (s) => wallOffset(s, from.x, py, from.z) < -BEHIND_EPS;
  if (!w.walls.some(behind)) return w;
  const front = w.walls.some((s) => !behind(s));
  const use = [];
  for (const s of w.walls) {
    if (!behind(s)) use.push(s);
    else if (!front) {
      const nearer = wallBetween(col, s, from, py);
      if (nearer && !behind(nearer)) {
        if (!use.includes(nearer)) use.push(nearer);
      } else if (!engagedBehind(s, from, offsetY, radius)) {
        const exit = nearerExit(col, s, x, py, z, radius) ?? s;
        if (!use.includes(exit)) use.push(exit);
      }
    }
  }
  // Replay the pushes in order with the chosen walls.
  const walls = [];
  for (const s of use) {
    if (py < s.minY || py > s.maxY) continue;
    const off = wallOffset(s, x, py, z);
    if (off < -radius || off > radius || !withinWall(s, x, py, z, radius * WALL_EDGE_MARGIN)) continue;
    x += s.hn.x * (radius - off);
    z += s.hn.z * (radius - off);
    walls.push(s);
  }
  return { x, z, walls };
}

// Tree trunks are solid cylinders: keeps the body POLE_BODY away from their surface. Returns
// a wall-like contact ({ hn, pole: true }, hn pointing away from the trunk) or null.
function pushOutOfPoles(collision, pos) {
  const pole = collision.findPole(pos.x, pos.y + 60, pos.z, POLE_BODY);
  if (!pole) return null;
  const dx = pos.x - pole.x;
  const dz = pos.z - pole.z;
  const d = Math.hypot(dx, dz) || 1e-6;
  const want = pole.radius + POLE_BODY;
  pos.x = pole.x + (dx / d) * want;
  pos.z = pole.z + (dz / d) * want;
  return { hn: { x: dx / d, z: dz / d }, pole: true };
}

const probe = { x: 0, y: 0, z: 0 };

// Resolves walls (two probes: offsetA/radiusA then offsetB/radiusB) and trunks for a move of
// the hero to (x, y, z). Leaves the result in `probe`; returns the most relevant contact.
function resolveHorizontal(p, x, y, z, offsetA, radiusA, offsetB, radiusB) {
  const col = p.collision;
  const a = pushOutOfWalls(col, p.pos, x, y, z, offsetA, radiusA);
  const b = pushOutOfWalls(col, p.pos, a.x, y, a.z, offsetB, radiusB);
  probe.x = b.x;
  probe.y = y;
  probe.z = b.z;
  return pushOutOfPoles(col, probe) ?? lastWall(b, lastWall(a, null));
}

// Room between the floor at height y and the ceiling over it.
function headroom(col, x, y, z) {
  return col.findCeil(x, y + CEIL_PROBE, z).y - y;
}

function groundQuarterStep(p, dx, dz, r) {
  const col = p.collision;
  const y = p.pos.y;
  const wall = resolveHorizontal(p, p.pos.x + dx, y, p.pos.z + dz, 30, 24, 60, 50);
  const { x, z } = probe;

  const floor = col.findFloor(x, y, z);
  if (!floor.surface) return STEP_HIT_WALL; // never walk off the collision mesh
  // No headroom ahead blocks, unless the hero is already squeezed under a lower ceiling
  // here (only reachable through broken geometry): then any move that doesn't make it
  // worse is allowed, so he can always work his way out.
  const room = headroom(col, x, floor.y, z);
  if (room < PLAYER_HEIGHT && room < headroom(col, p.pos.x, y, p.pos.z)) return STEP_HIT_WALL;
  p.pos.x = x;
  p.pos.z = z;
  if (floor.y < y - MAX_STEP_DOWN) return STEP_LEFT_GROUND;
  p.pos.y = floor.y;
  p.floor = floor;
  if (wall) r.wall = wall;
  return wall ? STEP_HIT_WALL : STEP_NONE;
}

// Moves the grounded hero by p.vel.x/z, snapping to floors. Result: STEP_NONE,
// STEP_HIT_WALL (r.wall set if a wall face or trunk was touched) or STEP_LEFT_GROUND.
export function groundStep(p) {
  const r = resetResult(groundRes);
  const moving = p.vel.x !== 0 || p.vel.z !== 0;
  const n = moving ? 4 : 1;
  for (let i = 0; i < n; i++) {
    const res = groundQuarterStep(p, p.vel.x / n, p.vel.z / n, r);
    if (res === STEP_LEFT_GROUND) {
      p.grounded = false;
      p.vel.y = 0;
      r.result = STEP_LEFT_GROUND;
      return r;
    }
    if (res === STEP_HIT_WALL) {
      r.result = STEP_HIT_WALL;
      if (!r.wall) break; // blocked by a floor / ceiling edge: stop here
    }
  }
  p.grounded = true;
  p.vel.y = 0;
  return r;
}

// One air quarter step moving by (dx, dz) horizontally and vel.y / 4 vertically. Returns
// STEP_BLOCKED without committing when the spot ahead has no room for the hero, unless
// `inPlace` (a retry without horizontal motion), which always commits.
function airQuarterStep(p, r, dx, dz, inPlace) {
  const col = p.collision;
  const ny = p.pos.y + p.vel.y / 4;
  const wall = resolveHorizontal(p, p.pos.x + dx, ny, p.pos.z + dz, 150, 50, 30, 50);
  const { x, z } = probe;

  const floor = col.findFloor(x, ny, z);
  // Ceilings already below the feet (passed from above) never push the hero down.
  const ceilY = col.findCeil(x, Math.max(ny, p.pos.y) + CEIL_PROBE, z).y;
  let y = ny;
  let hitCeiling = false;
  if (y + PLAYER_HEIGHT > ceilY) {
    y = ceilY - PLAYER_HEIGHT;
    hitCeiling = true;
  }
  const landing = floor.surface && y <= floor.y;
  if (landing && !inPlace && (hitCeiling || headroom(col, x, floor.y, z) < PLAYER_HEIGHT)) return STEP_BLOCKED;
  if (wall) r.wall = wall;
  p.pos.x = x;
  p.pos.z = z;
  p.floor = floor;
  if (landing) {
    p.pos.y = floor.y;
    return STEP_LANDED;
  }
  p.pos.y = y;
  if (hitCeiling) {
    if (p.vel.y > 0) p.vel.y = 0;
    r.hitCeiling = true;
  }
  return wall ? STEP_HIT_WALL : STEP_NONE;
}

// Moves the airborne hero by p.vel. Result: STEP_LANDED, STEP_HIT_WALL (r.wall) or STEP_NONE.
// A spot without room (low ceiling over it) stops the horizontal motion, never the vertical.
export function airStep(p) {
  const r = resetResult(airRes);
  p.grounded = false;
  for (let i = 0; i < 4; i++) {
    let res = airQuarterStep(p, r, p.vel.x / 4, p.vel.z / 4, false);
    if (res === STEP_BLOCKED) {
      p.vel.x = p.vel.z = 0;
      p.forwardVel = 0;
      p.airDrift = 0;
      r.result = STEP_HIT_WALL;
      res = airQuarterStep(p, r, 0, 0, true);
    }
    if (res === STEP_LANDED) {
      p.grounded = true;
      r.result = STEP_LANDED;
      return r;
    }
    if (res === STEP_HIT_WALL) r.result = STEP_HIT_WALL;
  }
  return r;
}

// One water quarter step; STEP_BLOCKED (nothing committed) when the spot ahead has no floor,
// no headroom, or is a steep bank rising above the floating depth (banks you can't wade up).
function waterQuarterStep(p, r, dx, dz) {
  const col = p.collision;
  let y = p.pos.y + p.vel.y / 4;
  const wall = resolveHorizontal(p, p.pos.x + dx, y, p.pos.z + dz, 110, 50, 10, 50);
  const { x, z } = probe;

  const floor = col.findFloor(x, y, z);
  if (!floor.surface) return STEP_BLOCKED;
  const level = col.waterLevelAt(x, z);
  const floatY = level - SURFACE_FLOAT_DEPTH;
  if (level !== NO_WATER && isSteep(floor) && floor.y > Math.max(p.pos.y, floatY)) return STEP_BLOCKED;
  if (y <= floor.y) {
    y = floor.y;
    r.onFloor = true;
  }
  const ceilY = col.findCeil(x, floor.y + CEIL_PROBE, z).y;
  if (y + PLAYER_HEIGHT > ceilY) {
    y = ceilY - PLAYER_HEIGHT;
    if (y < floor.y) return STEP_BLOCKED;
  }
  if (level === NO_WATER) r.noWater = true;
  else if (y >= floatY) {
    y = floatY;
    r.atSurface = true;
  }
  if (wall) r.wall = wall;
  p.pos.x = x;
  p.pos.y = Math.max(y, floor.y);
  p.pos.z = z;
  p.floor = floor;
  return wall ? STEP_HIT_WALL : STEP_NONE;
}

// Moves the swimming hero by p.vel, clamped between the floor and the floating depth.
// Flags on the result: atSurface, onFloor, noWater (swam out of the water volume).
export function waterStep(p) {
  const r = resetResult(waterRes);
  p.grounded = false;
  for (let i = 0; i < 4; i++) {
    let res = waterQuarterStep(p, r, p.vel.x / 4, p.vel.z / 4);
    if (res === STEP_BLOCKED) {
      r.result = STEP_HIT_WALL;
      res = waterQuarterStep(p, r, 0, 0);
    }
    if (res === STEP_HIT_WALL) r.result = STEP_HIT_WALL;
  }
  return r;
}
