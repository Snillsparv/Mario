// Keeps the follow camera out of walls, terrain and water, and keeps the hero in view.
//
// resolve() takes the unobstructed orbit position and returns where the camera may be:
//  * Hard limit: the camera never tunnels through a wall or ceiling on its own path (backing
//    into the castle, an orbit swinging through a wall). Along this tick's ray it may keep its
//    distance if it gets there from last tick's position without crossing one (otherwise it
//    comes back in front of the first surface seen from the look point), and may extend only
//    up to the next surface beyond. This applies immediately. Floors are left to the height
//    limit, which lifts the camera over terrain instead of dollying it in.
//  * Line of sight: sampled by a fan of three rays (a centre ray plus one starting 75 units to
//    either side, converging on the camera) from the look point, from the hero's chest while
//    the look point lags far above it (falls), and from where the chest will be a few ticks
//    from now (anticipation). Only a fully blocked fan counts, so posts, trunks and signs are
//    ignored and simply pass in front of the hero, as props did in the original. A blocked view
//    is answered, in order of preference, by
//      1. lifting the orbit pitch (never steeper than LIFT_MAX_PITCH) when that clears it:
//         parapets, fences, the moat rim, hill crests;
//      2. dollying in on a critically damped spring, but never closer than
//         max(450, 0.35 x distance); a wall on the way is crossed in one step (a cut);
//      3. accepting the occlusion: `occluded` is set and the controller slides the orbit
//         along the blocking wall while the hero moves.
//    Once pulled in or lifted, the camera holds until the view has been clear for a while,
//    then eases back out.
//  * Walls running alongside the view ray push the camera sideways (near-plane clearance);
//    the height is kept ~150 above the floor, below ceilings and above the water unless the
//    hero is submerged (acceleration- and speed-limited); finally the camera is kept out of
//    the hero's head and body, or `insideHero` is set so the game can hide the model.

import { NO_WATER, CEIL_NONE, FLOOR_LOWER_LIMIT } from '../core/constants.js';

const DEG = Math.PI / 180;
const PAD = 70; // stop this far in front of a hit along the ray
const EYE_PAD = 20; // the ray origin stays this far in front of a surface between it and the chest
const EYE_CHECK_DIST = 60; // ...checked once it is at least this far from the chest
const PREDICT_TICKS = 8; // how far ahead the hero's motion is extrapolated
const CHEST_HEIGHT = 80; // occlusion rays aim at the hero's chest...
const CHEST_RAY_GAP = 100; // ...separately from the look target once it is this far above it
const HEAD_TOP = 175; // top of the hero's head (hat) above the feet
const FAN_OFFSET = 75; // side rays of the sight fan start this far left/right of the origin
const SOFT_MIN_DIST = 450; // occlusion alone never dollies the camera closer than this...
const SOFT_MIN_FRACTION = 0.35; // ...or this fraction of the orbit distance
const LIFT_MAX_PITCH = 42 * DEG; // a lift never tilts the view ray steeper than this
const LIFT_CLEARANCE = 40; // a lifted sight line passes this far over the blocker's top
const LIFT_ROUNDS = 3; // blockers stacked behind each other that one lift search may clear
const SMALL_LIFT = 12 * DEG; // a lift up to this is preferred over dollying in
const LIFT_RATE = 0.25; // lift easing: fraction of the gap per tick...
const LIFT_MAX_SPEED = 3.5 * DEG; // ...never faster than this per tick...
const LIFT_ACCEL = 0.8 * DEG; // ...and changing speed by at most this per tick
const LIFT_RELEASE = 0.06; // fraction of the lift given back per tick once the view is clear
const OMEGA_HIDDEN = 0.9; // dolly spring stiffness (rad/tick) when the hero is hidden right now
const OMEGA_ANTICIPATE = 0.4; // ...when only the predicted view is blocked
const MAX_PULL_SPEED = 120; // units/tick cap on the occlusion dolly
const HOLD_TICKS = 10; // stay pulled in / lifted until the view has been clear this long
const HOLD_EPS = 0.02;
const RELEASE_RATE = 0.1;
const WALL_RADIUS = 60;
const BODY_CLEARANCE = 180; // minimum distance from the hero's chest-to-head segment
const FLOOR_QUERY_TOL = 100; // floors slightly above the camera still count (never overhangs)
const CEIL_QUERY_TOL = 50;
const PREDICT_FLOOR_TOL = 300; // a predicted point this far under a slope is lifted onto it
const FLOOR_CLEARANCE = 150;
const HARD_CLEARANCE = 40;
const CEIL_CLEARANCE = 60;
const WATER_MARGIN = 60;
const WATER_HARD_MARGIN = 20;
const ADJUST_RATE = 0.3; // vertical correction: fraction of the gap per tick...
const ADJUST_ACCEL = 25; // ...changing speed by at most this per tick...
const ADJUST_MAX_SPEED = 60; // ...and never faster than this (units/tick)
const WALLS_ONLY = { floors: false, ceilings: false };
const NO_FLOORS = { floors: false };

export class CameraCollider {
  constructor(collision) {
    this.collision = collision;
    this.reset();
  }

  reset() {
    this.ratio = null; // eased fraction of the desired distance the camera may use
    this.ratioVel = 0;
    this.clearTicks = 0;
    this.lift = 0; // eased extra pitch (radians) that clears a low blocker, its goal and speed
    this.liftGoal = 0;
    this.liftVel = 0;
    this.liftClearTicks = 0;
    this.adjustY = 0; // eased vertical correction and its speed
    this.adjustVel = 0;
    this.wasUnderwater = false;
    this.last = null; // last resolved camera position
    this.hardRatio = 1; // limit that must not be crossed this tick (applied immediately)
    this.viewRatio = 1; // free fraction of the current line of sight to the hero (fan)
    this.blocker = null; // last surface that hid the hero or pulled the camera in
    this.occluded = false; // hero hidden and neither a lift nor a dolly can help
    this.insideHero = false; // no room outside the hero's body: the model should be hidden
  }

  // Distance along dir (unit) the camera can safely sit at, up to maxDist.
  safeDistance(origin, dir, maxDist, opts) {
    const hit = this.collision.raycast(origin, dir, maxDist + PAD, opts);
    return { dist: hit ? Math.min(maxDist, Math.max(hit.distance - PAD, hit.distance * 0.5)) : maxDist, hit };
  }

  // target: look target; desired: unobstructed orbit position; hero: { x, y, z, velX, velY,
  // velZ, submerged }; out receives the result.
  resolve(target, desired, hero, out) {
    const chest = { x: hero.x, y: hero.y + CHEST_HEIGHT, z: hero.z };
    const eye = this._eyePoint(target, chest);
    const cam = this._liftPoint(eye, desired, this.lift);
    const dx = cam.x - eye.x;
    const dy = cam.y - eye.y;
    const dz = cam.z - eye.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) {
      out.set(cam.x, cam.y, cam.z);
      return out;
    }
    const dir = { x: dx / len, y: dy / len, z: dz / len };

    const centre = this.safeDistance(eye, dir, len);
    const front = centre.dist / len; // in front of the first surface on the ray

    // Sight lines to the unlifted orbit position (a lift is kept only while it is needed).
    // Without a lift the eye's centre ray is the one just cast.
    const origins = [eye];
    if (eye.y - chest.y > CHEST_RAY_GAP) origins.push(chest);
    const predicted = this._predictedChest(hero);
    if (predicted) origins.push(predicted);
    let tight = null;
    this.viewRatio = 1;
    for (const o of origins) {
      const f = this._fan(o, desired, o === eye && this.lift === 0 ? centre.hit : undefined);
      if (o === eye) this.hardRatio = centre.hit ? this._hardLimit(eye, dir, len, front, f.free < 1) : 1;
      if (o !== predicted) this.viewRatio = Math.min(this.viewRatio, f.free);
      if (f.free < (tight?.free ?? 1)) tight = f;
    }

    // Remedies (see top): a small lift, else a dolly that stays far enough out, else any lift.
    let liftGoal = 0;
    let soft = 1;
    if (tight) {
      this.blocker = tight.surface;
      const dolly = Math.min(front, (tight.free * len - PAD) / len);
      const d = dolly * len;
      const spot = { x: eye.x + dir.x * d - chest.x, y: eye.y + dir.y * d - chest.y, z: eye.z + dir.z * d - chest.z };
      const canDolly = Math.hypot(spot.x, spot.y, spot.z) >= Math.max(SOFT_MIN_DIST, SOFT_MIN_FRACTION * len);
      liftGoal = this._clearingLift(eye, origins, desired, tight, canDolly ? SMALL_LIFT : LIFT_MAX_PITCH);
      if (!liftGoal && canDolly) soft = dolly;
    }
    this.liftGoal = liftGoal;
    this._easeLift(liftGoal);
    const before = this.ratio;
    this._ease(soft, this.viewRatio < 1 ? OMEGA_HIDDEN : OMEGA_ANTICIPATE, len);
    if (centre.hit && this.ratio < before && before > front) this._hop(eye, dir, len, before, front);
    this.occluded = !!tight && !liftGoal && soft === 1;
    if (!tight && this.clearTicks > HOLD_TICKS) this.blocker = null;
    if (this.ratio > this.hardRatio) {
      this.ratio = this.hardRatio;
      this.ratioVel = Math.min(this.ratioVel, 0);
      if (centre.hit && this.ratio < 0.75) this.blocker = centre.hit.surface;
    }

    const d = this.ratio * len;
    out.set(eye.x + dir.x * d, eye.y + dir.y * d, eye.z + dir.z * d);
    this._pushFromWalls(out);
    this._limitHeight(out, hero.submerged);
    this._clearBody(out, hero, dir);
    this.last = { x: out.x, y: out.y, z: out.z };
    return out;
  }

  // Ray origin: the look target, but never below the hero's chest (the target lags behind
  // vertically and can sit inside a ledge the hero has just climbed) and never behind a
  // surface as seen from the chest (a look point lagging above a bridge deck the hero dropped
  // under, or into a tree the hero just grabbed).
  _eyePoint(target, chest) {
    const eye = { x: target.x, y: Math.max(target.y, chest.y), z: target.z };
    const d = { x: eye.x - chest.x, y: eye.y - chest.y, z: eye.z - chest.z };
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < EYE_CHECK_DIST) return eye;
    const hit = this.collision.raycast(chest, d, len + EYE_PAD);
    if (!hit) return eye;
    const k = Math.max(0, hit.distance - EYE_PAD) / len;
    return { x: chest.x + d.x * k, y: chest.y + d.y * k, z: chest.z + d.z * k };
  }

  // `p` rotated up about `eye` by `lift` (same yaw and distance). Capped at LIFT_MAX_PITCH
  // unless `uncapped`.
  _liftPoint(eye, p, lift, uncapped = false) {
    const dx = p.x - eye.x;
    const dz = p.z - eye.z;
    const h = Math.hypot(dx, dz);
    if (lift <= 0 || h < 1) return { x: p.x, y: p.y, z: p.z };
    const dy = p.y - eye.y;
    const len = Math.hypot(h, dy);
    const pitch0 = Math.atan2(dy, h);
    const pitch = uncapped ? pitch0 + lift : Math.max(pitch0, Math.min(pitch0 + lift, LIFT_MAX_PITCH));
    const k = (len * Math.cos(pitch)) / h;
    return { x: eye.x + dx * k, y: eye.y + len * Math.sin(pitch), z: eye.z + dz * k };
  }

  // Smallest pitch lift (at most maxLift, never past LIFT_MAX_PITCH) after which no sight line
  // is blocked, or 0 if there is none. Each round lifts the camera just enough for the tightest
  // blocked line to pass over the top of the surface it hit, then re-tests every line.
  _clearingLift(eye, origins, desired, blocked, maxLift) {
    const pitch0 = Math.atan2(desired.y - eye.y, Math.hypot(desired.x - eye.x, desired.z - eye.z));
    const room = Math.min(maxLift, LIFT_MAX_PITCH - pitch0);
    let lift = 0;
    for (let round = 0; round < LIFT_ROUNDS && room > 0; round++) {
      lift = this._liftOver(eye, desired, blocked, lift);
      if (lift > room) return 0;
      const p = this._liftPoint(eye, desired, lift);
      blocked = null;
      for (const o of origins) {
        const f = this._fan(o, p);
        if (f.free < 1) {
          blocked = f;
          break;
        }
      }
      if (!blocked) return lift;
    }
    return 0;
  }

  // Lift (>= `lift`) at which the sight line `f` (from f.from toward the lifted camera) passes
  // LIFT_CLEARANCE over the top of the surface it hit; Infinity if no lift can do that.
  _liftOver(eye, desired, f, lift) {
    const from = f.from;
    const top = f.surface.maxY + LIFT_CLEARANCE;
    const reach = Math.hypot(f.point.x - from.x, f.point.z - from.z);
    const len = Math.hypot(desired.x - eye.x, desired.y - eye.y, desired.z - eye.z);
    const pitch0 = Math.asin((desired.y - eye.y) / len);
    if (reach < 1) return Infinity;
    // The camera's horizontal reach shrinks as it rises, so refine the estimate twice.
    for (let i = 0; i < 2; i++) {
      const c = this._liftPoint(eye, desired, lift, true);
      const camReach = Math.hypot(c.x - from.x, c.z - from.z);
      if (camReach <= reach) return Infinity;
      const s = (from.y + ((top - from.y) * camReach) / reach - eye.y) / len;
      if (s >= 1) return Infinity;
      lift = Math.max(lift, Math.asin(s) - pitch0);
    }
    return lift;
  }

  // Raises quickly (speed and acceleration limited), gives back slowly after a hold.
  _easeLift(goal) {
    let want;
    if (goal >= this.lift - 1e-4) {
      this.liftClearTicks = 0;
      want = Math.min((goal - this.lift) * LIFT_RATE, LIFT_MAX_SPEED);
    } else {
      this.liftClearTicks++;
      want = this.liftClearTicks > HOLD_TICKS ? (goal - this.lift) * LIFT_RELEASE : 0;
    }
    this.liftVel = Math.min(Math.max(want, this.liftVel - LIFT_ACCEL), this.liftVel + LIFT_ACCEL);
    this.lift = Math.max(0, this.lift + this.liftVel);
    if (this.lift === 0) this.liftVel = Math.max(0, this.liftVel);
  }

  // Near-plane clearance from walls beside the view ray. findWalls also pushes points that
  // are just behind a thin or one-sided wall out through it, so a push that crosses a wall is
  // retried with a smaller radius and otherwise dropped.
  _pushFromWalls(out) {
    for (const radius of [WALL_RADIUS, WALL_RADIUS / 2]) {
      const pushed = this.collision.findWalls(out.x, out.y, out.z, 0, radius);
      const dx = pushed.x - out.x;
      const dz = pushed.z - out.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.01) return;
      if (!this.collision.raycast(out, { x: dx, y: 0, z: dz }, d, WALLS_ONLY)) {
        out.x = pushed.x;
        out.z = pushed.z;
        return;
      }
    }
  }

  // Moves the eased ratio toward the soft limit: spring in, hold, then ease out.
  _ease(soft, omega, len) {
    if (this.ratio === null) {
      this.ratio = soft;
      return;
    }
    if (soft < this.ratio) {
      // Critically damped spring toward the tighter distance (exact one-tick step).
      const e = this.ratio - soft;
      const k = this.ratioVel + omega * e;
      const decay = Math.exp(-omega);
      const next = soft + (e + k) * decay;
      const floor = this.ratio - MAX_PULL_SPEED / len;
      this.ratioVel = next < floor ? floor - this.ratio : (this.ratioVel - omega * k) * decay;
      this.ratio = Math.max(next, floor);
      this.clearTicks = 0;
      return;
    }
    this.ratioVel = 0;
    this.clearTicks = soft - this.ratio < HOLD_EPS ? 0 : this.clearTicks + 1;
    if (this.clearTicks > HOLD_TICKS) this.ratio += (soft - this.ratio) * RELEASE_RATE;
  }

  // Fraction of the ray the camera can reach without passing through a wall (see top). Right
  // after a reset there is no path: only a wall that hides the hero (`wide`) limits it.
  _hardLimit(eye, dir, len, view, wide) {
    const last = this.last;
    if (!last || this.ratio === null) return wide ? view : 1;
    const r = Math.min(this.ratio, 1);
    const p = { x: eye.x + dir.x * r * len, y: eye.y + dir.y * r * len, z: eye.z + dir.z * r * len };
    // The path is checked to where the height limit will put the camera, at least on top of
    // the ground (a ray point under the lawn is not a trip through the walls buried in it).
    const floorY = this._floorBelow(p);
    const my = (floorY > FLOOR_LOWER_LIMIT ? Math.max(p.y, floorY + HARD_CLEARANCE) : p.y) - last.y;
    const mx = p.x - last.x;
    const mz = p.z - last.z;
    const move = Math.hypot(mx, my, mz);
    if (move > 1 && this.collision.raycast(last, { x: mx, y: my, z: mz }, move, NO_FLOORS)) return view;
    if (r <= view) return view; // in front of the first surface: may extend up to it
    const ahead = this.collision.raycast(p, dir, (1 - r) * len + PAD, NO_FLOORS);
    return ahead ? Math.max(0, r * len + ahead.distance - PAD) / len : 1;
  }

  // The dolly from `from` toward the eye would enter a wall or ceiling (the far side of a big
  // occluder): cut to its near side instead of rendering from inside it. Only reached when
  // that spot is at least the soft minimum distance out (see resolve).
  _hop(eye, dir, len, from, front) {
    const d = from * len;
    const p = { x: eye.x + dir.x * d, y: eye.y + dir.y * d, z: eye.z + dir.z * d };
    const step = (from - this.ratio) * len + PAD;
    if (this.collision.raycast(p, { x: -dir.x, y: -dir.y, z: -dir.z }, step, NO_FLOORS)) {
      this.ratio = Math.min(this.ratio, front);
      this.ratioVel = 0;
    }
  }

  // Line of sight from `from` to `to`: free fraction (1 = nothing in the way), and the surface
  // and point it hit. `hit` passes in a ray already cast along the same line.
  _sightRay(from, to, hit) {
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 1) return { free: 1, surface: null, point: null, from };
    if (hit === undefined) hit = this.collision.raycast(from, d, len);
    if (!hit || hit.distance >= len) return { free: 1, surface: null, point: null, from };
    return { free: hit.distance / len, surface: hit.surface, point: hit.point, from };
  }

  // Line of sight sampled by a centre ray and one ray starting FAN_OFFSET to either side of
  // the origin (all converging on `to`). The loosest counts: a blocker has to cover the whole
  // fan (wider than ~150 units) to hide the hero. The side origins are cached on the origin
  // object, which lives for one tick.
  _fan(origin, to, centreHit) {
    let best = this._sightRay(origin, to, centreHit);
    if (best.free >= 1) return best;
    origin.sides ??= this._sideOrigins(origin, to);
    for (const side of origin.sides) {
      best = looser(best, this._sightRay(side, to));
      if (best.free >= 1) break;
    }
    return best;
  }

  // Side ray starts: FAN_OFFSET left and right of the origin, across the horizontal direction
  // to `to`, pulled in when a surface is closer (a ray must not start behind a wall) and
  // dropped when there is no room.
  _sideOrigins(origin, to) {
    const dx = to.x - origin.x;
    const dz = to.z - origin.z;
    const h = Math.hypot(dx, dz);
    const sides = [];
    if (h < 1) return sides;
    for (const s of [-1, 1]) {
      const side = { x: (dz / h) * s, y: 0, z: (-dx / h) * s };
      const hit = this.collision.raycast(origin, side, FAN_OFFSET + PAD);
      const off = hit ? hit.distance - PAD : FAN_OFFSET;
      if (off >= FAN_OFFSET / 2) sides.push({ x: origin.x + side.x * off, y: origin.y, z: origin.z + side.z * off });
    }
    return sides;
  }

  // Where the hero's chest will be a few ticks from now (null while it stands still). The
  // extrapolated point is stopped in front of any surface on the way (the hero will not pass
  // through it) and lifted onto the floor when it ends up under a rising slope.
  _predictedChest(hero) {
    let px = (hero.velX || 0) * PREDICT_TICKS;
    let py = (hero.velY || 0) * PREDICT_TICKS;
    let pz = (hero.velZ || 0) * PREDICT_TICKS;
    const plen = Math.hypot(px, py, pz);
    if (plen < 1) return null;
    const chest = { x: hero.x, y: hero.y + CHEST_HEIGHT, z: hero.z };
    const probe = this.collision.raycast(chest, { x: px, y: py, z: pz }, plen + PAD);
    if (probe) {
      const k = Math.max(0, probe.distance - PAD) / plen;
      px *= k;
      py *= k;
      pz *= k;
    }
    const p = { x: chest.x + px, y: chest.y + py, z: chest.z + pz };
    const floor = this.collision.findFloor(p.x, p.y, p.z, PREDICT_FLOOR_TOL).y;
    if (floor > FLOOR_LOWER_LIMIT) p.y = Math.max(p.y, floor + CHEST_HEIGHT);
    return p;
  }

  // Floor under a camera position. It is searched from last tick's height too: sinking with a
  // diving hero must not carry the camera through the ground it was above.
  _floorBelow(p) {
    return this.collision.findFloor(p.x, Math.max(p.y, this.last?.y ?? p.y), p.z, FLOOR_QUERY_TOL).y;
  }

  _limitHeight(out, submerged) {
    const col = this.collision;
    const rawY = out.y;
    const floorY = this._floorBelow(out);
    const ceilY = col.findCeil(out.x, rawY, out.z, CEIL_QUERY_TOL).y;
    const water = col.waterLevelAt(out.x, out.z);
    const hasFloor = floorY > FLOOR_LOWER_LIMIT;
    const hasWater = water !== NO_WATER;

    let lo = hasFloor ? floorY + FLOOR_CLEARANCE : -Infinity;
    let hi = ceilY < CEIL_NONE ? ceilY - CEIL_CLEARANCE : Infinity;
    if (hasWater) {
      if (submerged) hi = Math.min(hi, water - WATER_MARGIN);
      else lo = Math.max(lo, water + WATER_MARGIN);
    }
    // The floor wins over the water/ceiling limits when they conflict.
    const wanted = Math.max(Math.min(rawY, hi), lo);
    // Exponential approach with limited acceleration and speed: small corrections are quick,
    // big ones (diving under / surfacing) ramp up instead of lurching.
    // Right after a reset the correction applies at once.
    if (!this.last) this.adjustY = wanted - rawY;
    const want = (wanted - rawY - this.adjustY) * ADJUST_RATE;
    const vel = Math.min(Math.max(want, this.adjustVel - ADJUST_ACCEL), this.adjustVel + ADJUST_ACCEL);
    this.adjustVel = Math.max(-ADJUST_MAX_SPEED, Math.min(ADJUST_MAX_SPEED, vel));
    this.adjustY += this.adjustVel;
    let y = rawY + this.adjustY;

    if (hasFloor) y = Math.max(y, floorY + HARD_CLEARANCE);
    if (hasWater && !submerged && !this.wasUnderwater) y = Math.max(y, water + WATER_HARD_MARGIN);
    out.y = y;
    this.wasUnderwater = hasWater && y < water;
  }

  // Last resort in cramped spots (a wall right behind the hero, a pier underwater): keep the
  // camera BODY_CLEARANCE away from the hero's chest-to-head segment. It backs off along the
  // orbit direction if that is free, else rises over the head; if neither is possible it
  // flags insideHero so the model can be hidden.
  _clearBody(out, hero, dir) {
    this.insideHero = false;
    const lo = hero.y + CHEST_HEIGHT;
    const hi = hero.y + HEAD_TOP;
    const dy = out.y - Math.min(Math.max(out.y, lo), hi);
    let hx = out.x - hero.x;
    let hz = out.z - hero.z;
    const h = Math.hypot(hx, hz);
    if (h * h + dy * dy >= BODY_CLEARANCE * BODY_CLEARANCE) return;
    const col = this.collision;
    if (h > 1) {
      hx /= h;
      hz /= h;
    } else {
      const dh = Math.hypot(dir.x, dir.z) || 1;
      hx = dir.x / dh;
      hz = dir.z / dh;
    }
    const back = Math.sqrt(BODY_CLEARANCE * BODY_CLEARANCE - dy * dy) - h;
    if (!col.raycast(out, { x: hx, y: 0, z: hz }, back + PAD)) {
      out.x += hx * back;
      out.z += hz * back;
      return;
    }
    const up = hi + Math.sqrt(BODY_CLEARANCE * BODY_CLEARANCE - h * h) - out.y;
    if (up > 0 && !col.raycast(out, { x: 0, y: 1, z: 0 }, up + CEIL_CLEARANCE)) {
      out.y += up;
      return;
    }
    this.insideHero = true;
  }

  // True when rotating the orbit to `yaw` would put the camera hard against a wall.
  rotationBlocked(target, yaw, pitch, dist, minDist) {
    const cp = Math.cos(pitch);
    const dir = { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: Math.cos(yaw) * cp };
    const hit = this.collision.raycast(target, dir, dist, WALLS_ONLY);
    return !!hit && hit.distance < minDist;
  }
}

// The less blocked of two sight samples.
function looser(a, b) {
  return b.free > a.free ? b : a;
}
