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
const STEP_DOWN_RECHECK = 10; // stepping down more than this re-resolves walls at the new height
const LEDGE_SHOVE = 16; // ...and walls there shoving him further than this make it a walk-off
const CEIL_PROBE = 80; // ceilings are searched from floor + this (ignores a platform's own underside)
const BEHIND_EPS = 1; // tolerance for "the mover started behind this wall's plane"
const ENGAGE_MARGIN = 25; // a wall's back counts as in contact up to radius + this (one fast quarter step)
const WALK_OFF_TICKS = 20; // after walking off a ledge, wall pushes this many ticks become drifts...
const WALK_OFF_DRIFT = 12; // ...of this many units per tick
const WALK_OFF_DEPTH = 40; // the walk-off's own drift aims where the air probes put him this far down
const WALK_OFF_MIN = 8; // closer spots need no drift
const WALK_OFF_SETTLE = 3; // wall resolutions to settle a spot (concave corners take a few)
const FIT_EPS = 4; // a spot fits the hero when walls overlap him there by less than this

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
// a wall-like contact ({ hn, pole: true }, hn pointing away from the trunk) or null. A body
// right on the trunk's axis (dropping straight down from the handstand on its tip) is pushed
// out behind him (`yaw`: his facing).
function pushOutOfPoles(collision, pos, yaw) {
  const pole = collision.findPole(pos.x, pos.y + 60, pos.z, POLE_BODY);
  if (!pole) return null;
  let dx = pos.x - pole.x;
  let dz = pos.z - pole.z;
  if (dx * dx + dz * dz < 1e-6) {
    dx = -Math.sin(yaw);
    dz = -Math.cos(yaw);
  }
  const d = Math.hypot(dx, dz);
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
  return pushOutOfPoles(col, probe, p.faceYaw) ?? lastWall(b, lastWall(a, null));
}

// Room between the floor at height y and the ceiling over it.
function headroom(col, x, y, z) {
  return col.findCeil(x, y + CEIL_PROBE, z).y - y;
}

// Ground probes: knee (offset, radius) then chest. Air probes: high, then low.
const KNEE_Y = 30;
const KNEE_R = 24;
const CHEST_Y = 60;
const CHEST_R = 50;
const AIR_HIGH_Y = 150;
const AIR_LOW_Y = 30;
const AIR_R = 50;

// Where the hero at (x, y, z) ends up once pushed clear of walls and trunks, as the next
// ground (or air) step would place him. Returns the shared { x, z } probe; read it at once.
export function clearSpot(p, x, y, z, airborne = false) {
  if (airborne) resolveHorizontal(p, x, y, z, AIR_HIGH_Y, AIR_R, AIR_LOW_Y, AIR_R);
  else resolveHorizontal(p, x, y, z, KNEE_Y, KNEE_R, CHEST_Y, CHEST_R);
  return probe;
}

// Walking off a ledge slowly leaves the body overlapping it: only the centre has passed the
// edge. Falling past its side, the air probes would pop him out of it in one quarter step, up
// to his whole radius. Instead, for WALK_OFF_TICKS after a walk-off (p.walkOff), such a push
// becomes a drift toward where it leads, at WALK_OFF_DRIFT per tick (the walls meanwhile only
// stopping motion into them), as long as he fits there. The drift starts at the walk-off,
// toward where the air probes will put him once his feet are WALK_OFF_DEPTH below the top.
//
// Where the airborne hero at (x, y, z) settles once pushed clear of walls (a few passes, for
// concave corners), left in `spot`. Returns whether he fits there: not inside a solid, and no
// walls closer together than his width fighting over him.
const spot = { x: 0, z: 0 };
function settles(p, x, y, z) {
  for (let i = 0; i < WALK_OFF_SETTLE; i++) {
    const c = clearSpot(p, x, y, z, true);
    x = c.x;
    z = c.z;
  }
  spot.x = x;
  spot.z = z;
  if (p.collision.findFloor(x, y + PLAYER_HEIGHT, z, 0).y > y + FIT_EPS) return false;
  return !crowded(p.collision, p.pos, x, y, z);
}

// Points p.walkOff's drift at `spot` (inactive when it's already close).
function driftTo(p, w) {
  const dx = spot.x - p.pos.x;
  const dz = spot.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  w.x = spot.x;
  w.z = spot.z;
  w.ux = d > 0 ? dx / d : 0;
  w.uz = d > 0 ? dz / d : 0;
  w.active = d >= WALK_OFF_MIN;
}

// Steps the grounded hero off the ledge he stands on (at height p.pos.y) to (x, z), over a
// floor at floorY far below: STEP_LEFT_GROUND, or STEP_HIT_WALL (nothing moved) when there is
// no room for him down there (a crevice narrower than he is, e.g. between the door steps and
// a tower's base): he doesn't step off into it.
function walkOff(p, x, z, floorY) {
  const x0 = p.pos.x;
  const z0 = p.pos.z;
  p.pos.x = x;
  p.pos.z = z;
  p.walkOff = null;
  if (!settles(p, x, Math.max(p.pos.y - WALK_OFF_DEPTH, floorY), z)) {
    p.pos.x = x0;
    p.pos.z = z0;
    return STEP_HIT_WALL;
  }
  p.walkOff = { until: p.tick + WALK_OFF_TICKS, active: false, x: 0, z: 0, ux: 0, uz: 0 };
  driftTo(p, p.walkOff);
  return STEP_LEFT_GROUND;
}

// The extra motion for this air quarter step toward the walk-off drift's spot: enough to move
// that way at WALK_OFF_DRIFT per tick counting the hero's own motion (a fast walk-off needs
// none). Returns the shared { x, z } drift.
const drift = { x: 0, z: 0 };
function walkOffDrift(p) {
  drift.x = drift.z = 0;
  const w = p.walkOff;
  if (!w?.active) return drift;
  const left = (w.x - p.pos.x) * w.ux + (w.z - p.pos.z) * w.uz;
  if (left < 0.5) {
    w.active = false;
    return drift;
  }
  const own = (p.vel.x * w.ux + p.vel.z * w.uz) / 4;
  const extra = Math.max(0, Math.min(WALK_OFF_DRIFT / 4, left) - Math.max(0, own));
  drift.x = w.ux * extra;
  drift.z = w.uz * extra;
  return drift;
}

// Soon after a walk-off, a wall push on the air probe (resolved for the quarter step's move
// (dx, dz) to tx, y, tz) beyond undoing that move and a drift step becomes a drift toward
// where it leads, if he fits there; the probe then only undoes the move into the walls.
function easeWalkOff(p, tx, y, tz, dx, dz) {
  const w = p.walkOff;
  if (!w || p.tick >= w.until) return;
  const rx = probe.x;
  const rz = probe.z;
  const px = rx - tx;
  const pz = rz - tz;
  const push = Math.hypot(px, pz);
  const keep = push > 0 ? Math.max(0, -(dx * px + dz * pz) / push) : 0;
  if (push - keep <= WALK_OFF_DRIFT / 4) return;
  if (settles(p, rx, y, rz)) {
    driftTo(p, w);
    probe.x = tx + (px / push) * keep;
    probe.z = tz + (pz / push) * keep;
  } else {
    probe.x = rx;
    probe.z = rz;
  }
}

// True when walls still overlap the airborne hero's body at (x, y, z) by more than FIT_EPS
// once pushed clear: walls closer together than his width, fighting over him. Like the air
// steps, walls he is behind (at `from`) are ignored, and so is a coincident pair of opposite
// faces (the inside of two touching solids, e.g. the door steps' landing against their ramp).
function crowded(col, from, x, y, z) {
  return crowdedAt(col, from, x, y, z, AIR_HIGH_Y) || crowdedAt(col, from, x, y, z, AIR_LOW_Y);
}

function crowdedAt(col, from, x, y, z, offsetY) {
  const py = y + offsetY;
  const walls = col.findWalls(x, y, z, offsetY, AIR_R).walls;
  for (const s of walls) {
    const off = wallOffset(s, x, py, z);
    if (off < -BEHIND_EPS || off > AIR_R - FIT_EPS || !withinWall(s, x, py, z, AIR_R * WALL_EDGE_MARGIN)) continue;
    if (wallOffset(s, from.x, py, from.z) < -BEHIND_EPS) continue;
    const twin = walls.some((t) => t.hn.x * s.hn.x + t.hn.z * s.hn.z < -0.99 && Math.abs(wallOffset(t, x, py, z) + off) < 1);
    if (!twin) return true;
  }
  return false;
}

function groundQuarterStep(p, dx, dz, r) {
  const col = p.collision;
  const y = p.pos.y;
  let wall = resolveHorizontal(p, p.pos.x + dx, y, p.pos.z + dz, KNEE_Y, KNEE_R, CHEST_Y, CHEST_R);
  let { x, z } = probe;

  let floor = col.findFloor(x, y, z);
  if (!floor.surface) return STEP_HIT_WALL; // never walk off the collision mesh
  // No headroom ahead blocks, unless the hero is already squeezed under a lower ceiling
  // here (only reachable through broken geometry): then any move that doesn't make it
  // worse is allowed, so he can always work his way out.
  const room = headroom(col, x, floor.y, z);
  if (room < PLAYER_HEIGHT && room < headroom(col, p.pos.x, y, p.pos.z)) return STEP_HIT_WALL;
  // Stepping down onto a lower floor: the walls around the new height (the side of what he
  // stepped off, which his probes passed over) are resolved in this step, so he is never left
  // standing inside them for a tick (then shoved out the next). When they would shove him
  // far (stepping off a rock or a ledge with his body still over it), he walks off instead:
  // the fall's momentum carries him clear rather than a one-tick sideways snap.
  if (floor.y < y - STEP_DOWN_RECHECK && floor.y >= y - MAX_STEP_DOWN) {
    const pushed = resolveHorizontal(p, x, floor.y, z, KNEE_Y, KNEE_R, CHEST_Y, CHEST_R);
    const shove = Math.hypot(probe.x - x, probe.z - z);
    if (shove > LEDGE_SHOVE) return walkOff(p, x, z, floor.y);
    if (shove > 0) {
      const below = col.findFloor(probe.x, floor.y, probe.z);
      if (below.surface && headroom(col, probe.x, below.y, probe.z) >= PLAYER_HEIGHT) {
        x = probe.x;
        z = probe.z;
        floor = below;
        wall = pushed ?? wall;
      }
    }
  }
  if (floor.y < y - MAX_STEP_DOWN) return walkOff(p, x, z, floor.y);
  p.pos.x = x;
  p.pos.z = z;
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
  const wall = resolveHorizontal(p, p.pos.x + dx, ny, p.pos.z + dz, AIR_HIGH_Y, AIR_R, AIR_LOW_Y, AIR_R);
  if (p.walkOff) easeWalkOff(p, p.pos.x + dx, ny, p.pos.z + dz, dx, dz);
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

// Moves the airborne hero by p.vel (plus any walk-off drift). Result: STEP_LANDED,
// STEP_HIT_WALL (r.wall) or STEP_NONE. A spot without room (low ceiling over it) stops the
// horizontal motion, never the vertical.
export function airStep(p) {
  const r = resetResult(airRes);
  p.grounded = false;
  for (let i = 0; i < 4; i++) {
    const d = walkOffDrift(p);
    let res = airQuarterStep(p, r, p.vel.x / 4 + d.x, p.vel.z / 4 + d.z, false);
    if (res === STEP_BLOCKED) {
      p.vel.x = p.vel.z = 0;
      p.forwardVel = 0;
      p.airDrift = 0;
      r.result = STEP_HIT_WALL;
      res = airQuarterStep(p, r, 0, 0, true);
    }
    if (res === STEP_LANDED) {
      p.grounded = true;
      p.walkOff = null;
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
