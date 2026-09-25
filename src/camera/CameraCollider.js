// Keeps the follow camera out of walls, terrain and water, and keeps the hero in view.
//
// resolve() takes the unobstructed orbit position and returns where the camera may be:
//  * Line of sight: sampled by a fan of three rays (a centre ray plus one starting 75 units to
//    either side, converging on the camera) from the look point, from the hero's chest while
//    the look point lags far above it (falls), and from where the chest will be a few ticks
//    from now (anticipation). Only a fully blocked fan counts, so posts, trunks and signs are
//    ignored and simply pass in front of the hero, as props did in the original. A blocked view
//    is answered, in order of preference, by
//      1. a small pitch lift, when that clears it (a fence or parapet, the moat rim);
//      2. dollying in on a critically damped spring, but never closer than
//         max(450, 0.35 x distance) to the hero (`pullingIn`); stiff while the camera itself
//         cannot see him, gentle and no faster than ~1.5x his speed while it still can (only
//         the unlifted orbit position is blocked), so the remedy flipping from a lift to a
//         dolly on a hillside does not pop the camera in;
//      3. a larger lift (never steeper than LIFT_MAX_PITCH);
//      4. accepting the occlusion: `occluded` is set and the controller slides the orbit
//         along the blocking wall.
//    Once pulled in or lifted, the camera holds until the view has been clear for a while,
//    then eases back out. A lift that already keeps the hero in view stays the remedy while it
//    does (no flip from lifting to dollying half way down a hill).
//  * Parapet: with the hero up on a roof or tower top and the camera out over the drop beside
//    it (the floor under the camera PARAPET_DROP or more below his feet), a low wall close to
//    him (within PARAPET_REACH, no taller than he is: a battlement, whose crenels the fan lets
//    through) hiding his chest from the unlifted camera lifts the camera until the line to his
//    chest passes over it (at most LIFT_MAX_PITCH). Not in the tolerant (flight) mode.
//  * Trapped: the view is also checked from where the camera really ends up (straight lines
//    to the look point and the chest, no fan). A camera that has swung round behind something
//    solid (a corner tower) cannot dolly in front of it without tunnelling, so `hidden` counts
//    the ticks both have been out of sight from there (`stuck`: those with no lift rising and no
//    dolly moving the camera), `partHidden` those a standing hero's look point (his hat) has been
//    in sight but his chest hidden by something taller than he is, with no lift or dolly under
//    way (a pillar, which the sight fan lets pass, hiding all of him but the hat; not a fence or
//    a step he looks over). After TRAP_TICKS (PART_TRAP_TICKS) the camera
//    is `trapped` (and `occluded`): it stops dollying and the controller turns the orbit to a
//    clear view (sight.js). Hidden for TRAP_CUT_TICKS, the camera cuts to the spot in front of
//    the blocker if that is not too close to the hero (`jumped`: not interpolated). A swimmer is
//    left to cover.js / sight.js.
//  * Reach: along the ray the camera may extend up to the first surface while in front of it,
//    or up to the next one beyond while already past it. This applies immediately.
//  * Path: the camera never tunnels. A move into a wall or ceiling stops in front of it and
//    slides along it; floors are left to the height limit, which carries the camera over
//    terrain edges.
//  * Speed: the resolved camera moves at most STEP_MARGIN further per tick than the orbit
//    position or the hero moved (whichever moved more), so a camera released by a pillar it was
//    held back by, or pulled in toward a hero dropping out of sight into the moat, glides instead
//    of jumping. C-button swings, drags and teleports move the orbit position and pass through.
//  * Walls beside the camera push it sideways (near-plane clearance, never out through a wall it
//    is behind); the height is kept ~150
//    above the floor (down to 60 over an open slope falling away toward the hero, like the lawn
//    behind the spawn), below ceilings and above the water unless the hero is submerged
//    (acceleration- and speed-limited); in cramped spots the camera rises over the hero's head
//    rather than entering it, and `insideHero` asks the game to hide the model if it cannot.
//    `heightLift` reports how far that height limit raised the camera this tick (the controller
//    raises its aim by as much, so rising ground behind the camera does not tip the view down).
//    A covered swimmer (`hero.covered`: a low deck overhead) counts as submerged here.
//  * Crest (crest.js): over a hill crest that hides the hero's legs but not the look point the
//    camera rises until the line to his shins passes over it (dry land only).
//  * Tolerant (`tolerant`, set by the controller for the winged-hat flight camera): a flying hero
//    passes things quickly, so a blocked view is answered by any lift up to LIFT_MAX_PITCH before
//    a dolly, a dolly never brings the camera closer than max(TOLERANT_MIN_DIST, TOLERANT_MIN_FRACTION
//    x distance), and it pulls in gently (TOLERANT_OMEGA, at most TOLERANT_PULL_SPEED per tick).
//    The reach limit, the path, the wall push and the height limit apply as ever; `slid` reports
//    a tick the path or the wall push moved the camera sideways (the flight camera then rises).
//
// Runs every tick: all working points, directions and sight-line records are per-instance
// scratch objects reused each tick (no per-tick garbage). Values read from a raycast hit are
// copied out right away, so nothing depends on the hit object living on.

import { NO_WATER, CEIL_NONE, FLOOR_LOWER_LIMIT } from '../core/constants.js';
import { CrestRise } from './crest.js';

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
const LIFT_NUDGE = 1 * DEG;
const SMALL_LIFT = 12 * DEG; // a lift up to this is preferred over dollying in...
const LIFT_KEEP = 5 * DEG; // ...as is one up to this above the lift already in place
const LIFT_RATE = 0.25; // lift easing: fraction of the gap per tick...
const LIFT_MAX_SPEED = 3.5 * DEG; // ...never faster than this per tick...
const LIFT_ACCEL = 0.8 * DEG; // ...and changing speed by at most this per tick
const LIFT_RELEASE = 0.06; // fraction of the lift given back per tick once the view is clear
const OMEGA_HIDDEN = 0.9; // dolly spring stiffness (rad/tick) when the hero is hidden right now
const OMEGA_ANTICIPATE = 0.4; // ...when only the predicted view is blocked, or the camera itself
// still sees the look point (a lift keeps it over a hill the orbit position is behind)
const MAX_PULL_SPEED = 75; // units/tick cap on the occlusion dolly...
const SEEN_PULL_SPEED = 1.5; // ...or this times the hero's speed while the camera still sees it...
const SEEN_PULL_MIN = 25; // ...but at least this (no pop when the remedy flips from lift to dolly)
const HOLD_TICKS = 10; // stay pulled in / lifted until the view has been clear this long
const HOLD_EPS = 0.02;
const RELEASE_RATE = 0.12; // easing back out: fraction of the gap per tick...
const RELEASE_MAX_SPEED = 75; // ...at most this many units per tick...
const RELEASE_ACCEL = 10; // ...reached with this acceleration (units/tick^2)
const WALL_RADIUS = 60;
const PUSH_SLACK = 20; // a wall push goes at most this far past its radius (out of a slight overlap)
const SEE_TOL = 25; // hits this close to the camera do not hide the hero from it
// Trapped (see top): the look point and the chest out of sight from the resolved camera for
// TRAP_TICKS with no remedy making progress (or HIDDEN_TRAP_TICKS in all), or a standing hero's
// chest behind something taller than him (no lift or dolly under way) for PART_TRAP_TICKS;
// both hidden for TRAP_CUT_TICKS: cut in front of the blocker.
const TRAP_TICKS = 6;
const HIDDEN_TRAP_TICKS = 30;
const PART_TRAP_TICKS = 30;
const TRAP_CUT_TICKS = 45;
const TRAP_PROGRESS = 10; // (a dolly still moving the camera this far per tick is working)
const PARAPET_DROP = 400; // parapet lift (see top): the camera is out over a drop this deep...
const PARAPET_REACH = 350; // ...and the wall hiding the chest this close to the hero
const STANDING_SPEED = 2; // partHidden: the hero moves slower than this (units/tick)
const HERO_SIDE = 30; // heroInView: points this far left/right of the chest (across the view)...
const HERO_POINTS = [30, 80, 125]; // ...and on his centre line this high above the feet
const STEP_MARGIN = 40; // speed limit: this much more than the orbit position or the hero moved
const TOLERANT_MIN_DIST = 600; // tolerant (see top): the dolly stops this far from the hero...
const TOLERANT_MIN_FRACTION = 0.5; // ...or at this fraction of the orbit distance...
const TOLERANT_OMEGA = 0.3; // ...on a softer spring...
const TOLERANT_PULL_SPEED = 30; // ...at most this many units per tick
const SLIDE_SKIN = 25; // a camera sliding along a wall keeps this far off it
const RESET_YAW_DEG = 30; // yaw steps a reset tries when the spot behind the hero is walled in
const BODY_CLEARANCE = 180; // minimum distance from the hero's chest-to-head segment...
const BODY_RAMP = 300; // ...reached by rising gradually from this horizontal distance in
const BODY_MIN = 70; // closer than this to the segment the camera is inside the hero's body
const FLOOR_QUERY_TOL = 100; // floors slightly above the camera still count (never overhangs)
const CEIL_QUERY_TOL = 50;
const PREDICT_FLOOR_TOL = 300; // a predicted point this far under a slope is lifted onto it
const FLOOR_CLEARANCE = 150;
// Over an open slope falling away toward the hero (the lawn climbing behind the spawn) the ground
// in front of the camera drops faster than its view line, so it may sit lower: the clearance
// shrinks to SLOPE_CLEARANCE where the floor SLOPE_PROBE toward the hero is SLOPE_FULL (per unit)
// or more below the floor under the camera, and grows back to the full one toward SLOPE_EDGE (a
// drop-off: a bank, a cliff or a ledge, where the edge would hide the hero instead).
const SLOPE_CLEARANCE = 60;
const SLOPE_PROBE = 400;
const SLOPE_FULL = 0.15;
const SLOPE_EDGE = [0.4, 0.6];
const HARD_CLEARANCE = 40;
const CEIL_CLEARANCE = 60;
const WATER_MARGIN = 60;
const WATER_HARD_MARGIN = 20;
const ADJUST_RATE = 0.3; // vertical correction: fraction of the gap per tick...
const ADJUST_ACCEL = 25; // ...changing speed by at most this per tick...
const ADJUST_MAX_SPEED = 60; // ...and never faster than this (units/tick)
const WALLS_ONLY = Object.freeze({ floors: false, ceilings: false });
const NO_FLOORS = Object.freeze({ floors: false });

const vec = () => ({ x: 0, y: 0, z: 0 });
// Scalar eased state (copyState); `last` and the crest are copied separately.
const STATE_KEYS = [
  'ratio', 'ratioFresh', 'ratioVel', 'clearTicks', 'lift', 'liftGoal', 'liftVel', 'liftClearTicks',
  'adjustY', 'adjustVel', 'heightLift', 'wasUnderwater', 'offRay', 'slid', 'hardRatio', 'viewRatio', 'blocker',
  'occluded', 'pullingIn', 'insideHero', 'hidden', 'stuck', 'partHidden', 'chestHidden', 'trapped', 'jumped', 'stepValid',
  'tolerant',
];
// Line-of-sight sample: free fraction (1 = nothing in the way), the surface it hit, the hit
// point (valid while free < 1) and the ray's start.
const sightRecord = () => ({ free: 1, surface: null, point: vec(), from: null });
// A sight-line origin (look point, chest, predicted chest) with its fan: the side starts
// (computed once per tick) and one sight record per ray (centre, left, right).
const originRecord = () => ({ x: 0, y: 0, z: 0, sides: [vec(), vec()], sideCount: 0, sidesValid: false, rays: [sightRecord(), sightRecord(), sightRecord()] });
// Copy of a raycast hit.
const hitRecord = () => ({ hit: false, distance: 0, surface: null, point: vec(), nx: 0, ny: 0, nz: 0, dot: 0 });

function copyVec(a, out) {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
}

function copyHit(hit, out) {
  out.hit = true;
  out.distance = hit.distance;
  out.surface = hit.surface;
  out.point.x = hit.point.x;
  out.point.y = hit.point.y;
  out.point.z = hit.point.z;
  out.nx = hit.normal.x;
  out.ny = hit.normal.y;
  out.nz = hit.normal.z;
  return out;
}

export class CameraCollider {
  constructor(collision) {
    this.collision = collision;
    // Per-tick scratch (see top).
    this._eye = originRecord();
    this._chest = originRecord();
    this._predicted = originRecord();
    this._parapetRay = sightRecord(); // _parapetLift scratch
    this._origins = [null, null, null]; // eye, chest (while far below the eye), predicted chest
    this._originCount = 0;
    this._cam = vec();
    this._dir = vec();
    this._ray = vec(); // direction scratch for raycasts (read by the ray, never kept)
    this._centre = hitRecord(); // the view ray from the look point to the camera
    this._liftP = vec();
    this._liftC = vec();
    this._flat = vec();
    this._stop = vec();
    this._slid = vec();
    this._enter = hitRecord();
    this._reachP = vec();
    this._lastPos = vec();
    this._heroPt = vec(); // heroInView / clearHeroYaw scratch
    this._heroAt = vec();
    this._lastDesired = vec(); // last tick's orbit position and hero feet (speed limit)
    this._lastHero = vec();
    this.crest = new CrestRise(collision);
    this.reset();
  }

  reset() {
    this.ratio = 1; // eased fraction of the desired distance the camera may use...
    this.ratioFresh = true; // ...not eased yet since the reset (always a number: no boxing)
    this.ratioVel = 0;
    this.clearTicks = 0;
    this.lift = 0; // eased extra pitch (radians) that clears a low blocker, its goal and speed
    this.liftGoal = 0;
    this.liftVel = 0;
    this.liftClearTicks = 0;
    this.adjustY = 0; // eased vertical correction and its speed
    this.adjustVel = 0;
    this.heightLift = 0; // how far the height limit raised the camera this tick
    this.crest.reset(); // held rise that keeps the hero's feet in view over a crest
    this.wasUnderwater = false;
    this.last = null; // last resolved camera position...
    this.offRay = false; // ...and whether corrections moved it off its orbit ray
    this.slid = false; // this tick a wall stopped or pushed the camera sideways (path slide, wall push)
    this.hardRatio = 1; // limit that must not be crossed this tick (applied immediately)
    this.viewRatio = 1; // free fraction of the current line of sight to the hero (fan)
    this.blocker = null; // last surface that hid the hero or pulled the camera in
    this.occluded = false; // hero hidden and neither a lift nor a dolly can help
    this.pullingIn = false; // the dolly is pulling the camera in front of a blocker (liftGoal > 0: lifting over it)
    this.insideHero = false; // no room outside the hero's body: the model should be hidden
    this.hidden = 0; // ticks the look point and the chest have been out of sight from the camera...
    this.stuck = 0; // ...of those, the ticks with no lift rising and no dolly moving it...
    this.partHidden = 0; // ...ticks a standing hero's chest has been (by something taller than him), not the look point
    this.chestHidden = 0; // ticks the chest has been hidden by something taller than the hero (the C-button probe)
    this.trapped = false; // the camera is stuck behind something (see top)
    this.jumped = false; // this tick cut the camera in front of the blocker (do not interpolate)
    this.stepValid = false; // _lastDesired / _lastHero hold last tick's (speed limit)
    this.tolerant = false; // flight camera: lift first, dolly gently (see top; the controller sets it every tick)
  }

  // Copies the eased state of another collider (the controller's probe runs a C-button
  // rotation ahead on a copy to see whether it would trap the camera).
  copyState(src) {
    for (const k of STATE_KEYS) this[k] = src[k];
    this.crest.rise = src.crest.rise;
    this.crest.hold = src.crest.hold;
    copyVec(src._lastDesired, this._lastDesired);
    copyVec(src._lastHero, this._lastHero);
    if (src.last) {
      const lp = this._lastPos;
      lp.x = src.last.x;
      lp.y = src.last.y;
      lp.z = src.last.z;
      this.last = lp;
    } else this.last = null;
  }

  // Held crest rise (crest.js), for previews and tests.
  get crestRise() {
    return this.crest.rise;
  }

  // Distance along dir (unit) the camera can safely sit at, up to maxDist. The ray's hit (if
  // any) is copied into `hitOut`.
  safeDistance(origin, dir, maxDist, hitOut, opts) {
    const hit = this.collision.raycast(origin, dir, maxDist + PAD, opts);
    hitOut.hit = false;
    if (!hit) return maxDist;
    copyHit(hit, hitOut);
    return Math.min(maxDist, Math.max(hit.distance - PAD, hit.distance * 0.5));
  }

  // target: look target; desired: unobstructed orbit position; hero: { x, y, z, velX, velY,
  // velZ, inWater, submerged, covered }; out receives the result. `settled` is internal (see the reset lift).
  resolve(target, desired, hero, out, settled = false) {
    const chest = this._chest;
    chest.x = hero.x;
    chest.y = hero.y + CHEST_HEIGHT;
    chest.z = hero.z;
    chest.sidesValid = false;
    const eye = this._eyePoint(target, chest, this._eye);
    eye.sidesValid = false;
    const cam = this._liftPoint(eye, desired, this.lift, false, this._cam);
    const dx = cam.x - eye.x;
    const dy = cam.y - eye.y;
    const dz = cam.z - eye.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.heightLift = 0;
    if (len < 1) {
      out.set(cam.x, cam.y, cam.z);
      return out;
    }
    const dir = this._dir;
    dir.x = dx / len;
    dir.y = dy / len;
    dir.z = dz / len;

    const centre = this._centre;
    const front = this.safeDistance(eye, dir, len, centre) / len; // in front of the first surface on the ray

    // Sight lines to the unlifted orbit position (a lift is kept only while it is needed).
    // Without a lift the eye's centre ray is the one just cast.
    const eyeRay = this._sightRay(eye, desired, this.lift === 0 ? (centre.hit ? centre : null) : undefined, eye.rays[0]);
    // (A fixed array and a count: truncating an array would drop its storage every tick.)
    const origins = this._origins;
    let count = 0;
    origins[count++] = eye;
    if (eye.y - chest.y > CHEST_RAY_GAP) origins[count++] = chest;
    const predicted = this._predictedChest(hero, this._predicted);
    if (predicted) origins[count++] = predicted;
    this._originCount = count;
    let tight = null;
    this.viewRatio = 1;
    for (let i = 0; i < count; i++) {
      const o = origins[i];
      const f = this._fan(o, desired, o === eye ? eyeRay : undefined);
      if (o === eye) this.hardRatio = centre.hit ? this._reachLimit(eye, dir, len, front, f.free < 1) : 1;
      if (o !== predicted) this.viewRatio = Math.min(this.viewRatio, f.free);
      if (f.free < (tight ? tight.free : 1)) tight = f;
    }

    // Remedies (see top): a small lift, a dolly that stays far enough out, any lift, or none.
    // (`tight` is a scratch record: only its truthiness is read after _clearingLift.)
    let liftGoal = 0;
    let soft = 1;
    if (tight) {
      this.blocker = tight.surface;
      const dolly = Math.min(front, (tight.free * len - PAD) / len);
      const d = dolly * len;
      const sx = eye.x + dir.x * d - chest.x;
      const sy = eye.y + dir.y * d - chest.y;
      const sz = eye.z + dir.z * d - chest.z;
      const canDolly = Math.sqrt(sx * sx + sy * sy + sz * sz) >= (this.tolerant ? tolerantMin(len) : softMin(len));
      // (A lift already in place stays the remedy while it is enough, or while the camera sees
      // the hero from it: switching to a dolly then would pull the camera in on top of the lift.
      // Tolerant: any lift before a dolly.)
      const maxLift = canDolly && !this.tolerant ? Math.max(SMALL_LIFT, Math.min(this.lift + LIFT_KEEP, LIFT_MAX_PITCH)) : LIFT_MAX_PITCH;
      liftGoal = this._clearingLift(eye, origins, desired, tight, maxLift);
      if (!liftGoal && canDolly && this.lift > 0 && this._fansClear(cam)) liftGoal = this.lift;
      if (!liftGoal && canDolly) soft = dolly;
    }
    // A battlement between the camera out over the drop and the hero's chest (see top).
    if (!this.tolerant) {
      const parapet = this._parapetLift(eye, chest, desired, hero);
      if (parapet > liftGoal) {
        liftGoal = parapet;
        soft = 1;
      }
    }
    // Trapped behind a blocker, a dolly cannot get in front of it: stay out on the orbit (the
    // controller turns it back to a clear view, and the camera retraces its way round).
    if (this.trapped) soft = 1;
    this.liftGoal = liftGoal;
    this.pullingIn = soft < 1;
    // Right after a reset the lift applies at once (the camera starts behind the low wall).
    if (!this.last && !settled && liftGoal !== this.lift) {
      this.lift = liftGoal;
      return this.resolve(target, desired, hero, out, true);
    }
    this._easeLift(liftGoal);
    // Pulling in: fast while the hero is hidden from the camera itself, but gently, never much
    // faster than the hero moves, while the camera still sees him (only the unlifted orbit
    // position is blocked: a lift keeps it over a hill, and the remedy flips from lift to dolly).
    let omega = OMEGA_ANTICIPATE;
    let maxPull = MAX_PULL_SPEED;
    if (soft < this.ratio) {
      const last = this.last;
      if (last && this.lineClear(eye, last) && this.lineClear(chest, last)) {
        maxPull = Math.max(SEEN_PULL_MIN, SEEN_PULL_SPEED * heroSpeed(hero));
      } else if (this.viewRatio < 1) omega = OMEGA_HIDDEN;
      if (this.tolerant) {
        omega = Math.min(omega, TOLERANT_OMEGA);
        maxPull = Math.min(maxPull, TOLERANT_PULL_SPEED);
      }
    }
    this._ease(soft, omega, len, maxPull);
    this.occluded = !!tight && !liftGoal && soft === 1;
    if (!tight && this.clearTicks > HOLD_TICKS) this.blocker = null;
    if (this.ratio > this.hardRatio) {
      this.ratio = this.hardRatio;
      this.ratioVel = Math.min(this.ratioVel, 0);
      if (centre.hit && this.ratio < 0.75) this.blocker = centre.surface;
    }

    // Trapped behind a blocker for too long (see top): cut to the spot in front of it, unless
    // that is too close to the hero.
    let cut = false;
    if (this.hidden >= TRAP_CUT_TICKS && this.ratio > front) {
      const d = front * len;
      const sx = eye.x + dir.x * d - chest.x;
      const sy = eye.y + dir.y * d - chest.y;
      const sz = eye.z + dir.z * d - chest.z;
      cut = Math.sqrt(sx * sx + sy * sy + sz * sz) >= softMin(len);
      if (cut) {
        this.ratio = front;
        this.ratioVel = 0;
      }
    }
    const d = this.ratio * len;
    out.set(eye.x + dir.x * d, eye.y + dir.y * d, eye.z + dir.z * d);
    // The sideways part of the move is checked at last tick's height (the height limit then
    // settles y), so a camera underwater cannot slip into the island below its rim. A clear
    // ray vouches for the path only if the camera was on its ray last tick.
    const last = this.last;
    const rx = out.x;
    const ry = out.y;
    const rz = out.z;
    if (last && !cut && (centre.hit || this.offRay)) {
      const flat = this._flat;
      flat.x = out.x;
      flat.y = last.y;
      flat.z = out.z;
      this._slideMove(last, flat);
      out.x = flat.x;
      out.z = flat.z;
    }
    this._pushFromWalls(out);
    this.slid = Math.abs(out.x - rx) + Math.abs(out.z - rz) > 1;
    this._limitHeight(out, hero);
    this._clearBody(out, hero);
    if (!cut && this._limitStep(out, desired, hero)) this._clearBody(out, hero);
    // Can the camera see the hero from where it really is? (Sight lines above ran to the orbit
    // position; walls may have stopped the camera elsewhere.)
    this.jumped = cut;
    // (Not counted while a remedy is under way: the lift still rising, or the dolly still moving
    // the camera, if only sliding it along a wall toward a view.)
    let moved = 0;
    if (last) {
      const mx = out.x - last.x;
      const mz = out.z - last.z;
      moved = Math.sqrt(mx * mx + mz * mz);
    }
    const working = this.lift < this.liftGoal - 1e-3 || (this.pullingIn && moved > TRAP_PROGRESS);
    if (cut || hero.inWater) {
      this.hidden = 0;
      this.stuck = 0;
      this.partHidden = 0;
      this.chestHidden = 0;
    } else {
      const eyeSeen = !this._lineHit(eye, out);
      const chestHit = this._lineHit(chest, out);
      const hidden = !eyeSeen && !!chestHit;
      this.hidden = hidden ? this.hidden + 1 : 0;
      this.stuck = hidden ? this.stuck + (working ? 0 : 1) : 0;
      const idle = this.lift === 0 && this.liftGoal === 0 && !this.pullingIn && heroSpeed(hero) < STANDING_SPEED;
      const tall = !!chestHit && chestHit.surface.maxY > hero.y + HEAD_TOP;
      this.partHidden = eyeSeen && tall && idle ? this.partHidden + 1 : 0;
      // Only blockers taller than the hero count: he stays in view over a low fence or wall.
      this.chestHidden = tall ? this.chestHidden + 1 : 0;
    }
    this.trapped = this.stuck >= TRAP_TICKS || this.hidden >= HIDDEN_TRAP_TICKS || this.partHidden >= PART_TRAP_TICKS;
    if (this.trapped) this.occluded = true;
    this.offRay = Math.abs(out.x - rx) + Math.abs(out.y - ry) + Math.abs(out.z - rz) > 1;
    const lp = this._lastPos;
    lp.x = out.x;
    lp.y = out.y;
    lp.z = out.z;
    this.last = lp;
    return out;
  }

  // Speed limit (see top): shortens this tick's move from last tick's position toward `out`
  // (a point on a path the slide has checked). Returns whether it did.
  _limitStep(out, desired, hero) {
    const ld = this._lastDesired;
    const lh = this._lastHero;
    const valid = this.stepValid && this.last;
    const orbit = valid ? dist3(desired, ld) : 0;
    const heroStep = valid ? dist3(hero, lh) : 0;
    copyVec(desired, ld);
    copyVec(hero, lh);
    this.stepValid = true;
    if (!valid) return false;
    const last = this.last;
    const mx = out.x - last.x;
    const my = out.y - last.y;
    const mz = out.z - last.z;
    const move = Math.sqrt(mx * mx + my * my + mz * mz);
    const max = Math.max(orbit, heroStep) + STEP_MARGIN;
    if (move <= max) return false;
    const k = max / move;
    out.x = last.x + mx * k;
    out.y = last.y + my * k;
    out.z = last.z + mz * k;
    // (The shorter move must not leave the camera under the floor, and the water side is
    // wherever it now is.)
    const floorY = this._floorBelow(out);
    if (floorY > FLOOR_LOWER_LIMIT) out.y = Math.max(out.y, floorY + HARD_CLEARANCE);
    const water = this.collision.waterLevelAt(out.x, out.z);
    this.wasUnderwater = water !== NO_WATER && out.y < water;
    return true;
  }

  // The camera never tunnels: a move from `from` to `to` that would enter a wall or ceiling
  // stops just in front of it and slides along it instead (round the island's corner, along
  // the castle wall). Leaving a surface through its back is allowed, and floors are the
  // height limit's job (it carries the camera over terrain edges). Updates `to` in place.
  _slideMove(from, to) {
    const hit = this._entering(from, to, this._enter);
    if (!hit) return;
    const nx = hit.nx;
    const ny = hit.ny;
    const nz = hit.nz;
    const mx = to.x - from.x;
    const my = to.y - from.y;
    const mz = to.z - from.z;
    const move = Math.sqrt(mx * mx + my * my + mz * mz);
    const k = Math.max(0, hit.distance - SLIDE_SKIN / Math.max(0.2, -hit.dot)) / move;
    const stop = this._stop;
    stop.x = from.x + mx * k;
    stop.y = from.y + my * k;
    stop.z = from.z + mz * k;
    // Rest of the move, minus its component into the surface.
    const into = (to.x - stop.x) * nx + (to.y - stop.y) * ny + (to.z - stop.z) * nz;
    const slid = this._slid;
    slid.x = to.x - nx * into;
    slid.y = to.y - ny * into;
    slid.z = to.z - nz * into;
    const end = this._entering(stop, slid, this._enter) ? stop : slid;
    to.x = end.x;
    to.y = end.y;
    to.z = end.z;
  }

  // First wall or ceiling the straight move from a to b enters through its front (copied into
  // `out`, with `dot` = cosine between the move and the surface normal), or null.
  _entering(a, b, out) {
    const d = this._ray;
    d.x = b.x - a.x;
    d.y = b.y - a.y;
    d.z = b.z - a.z;
    const move = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    if (move < 1) return null;
    const hit = this.collision.raycast(a, d, move, NO_FLOORS);
    if (!hit) return null;
    const dot = (d.x * hit.normal.x + d.y * hit.normal.y + d.z * hit.normal.z) / move;
    if (dot >= 0) return null;
    copyHit(hit, out);
    out.dot = dot;
    return out;
  }

  // Ray origin: the look target, but never below the hero's chest (the target lags behind
  // vertically and can sit inside a ledge the hero has just climbed) and never behind a
  // surface as seen from the chest (a look point lagging above a bridge deck the hero dropped
  // under, or into a tree the hero just grabbed). Written into `out`.
  _eyePoint(target, chest, out) {
    out.x = target.x;
    out.y = Math.max(target.y, chest.y);
    out.z = target.z;
    const d = this._ray;
    d.x = out.x - chest.x;
    d.y = out.y - chest.y;
    d.z = out.z - chest.z;
    const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    if (len < EYE_CHECK_DIST) return out;
    const hit = this.collision.raycast(chest, d, len + EYE_PAD);
    if (!hit) return out;
    const k = Math.max(0, hit.distance - EYE_PAD) / len;
    out.x = chest.x + d.x * k;
    out.y = chest.y + d.y * k;
    out.z = chest.z + d.z * k;
    return out;
  }

  // `p` rotated up about `eye` by `lift` (same yaw and distance), written into `out`. Capped
  // at LIFT_MAX_PITCH unless `uncapped`.
  _liftPoint(eye, p, lift, uncapped, out) {
    const dx = p.x - eye.x;
    const dz = p.z - eye.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    if (lift <= 0 || h < 1) {
      out.x = p.x;
      out.y = p.y;
      out.z = p.z;
      return out;
    }
    const dy = p.y - eye.y;
    const len = Math.sqrt(h * h + dy * dy);
    const pitch0 = Math.atan2(dy, h);
    const pitch = uncapped ? pitch0 + lift : Math.max(pitch0, Math.min(pitch0 + lift, LIFT_MAX_PITCH));
    const k = (len * Math.cos(pitch)) / h;
    out.x = eye.x + dx * k;
    out.y = eye.y + len * Math.sin(pitch);
    out.z = eye.z + dz * k;
    return out;
  }

  // Whether no sight fan (from any of this tick's origins) is blocked on its way to p.
  _fansClear(p) {
    for (let i = 0; i < this._originCount; i++) if (this._fan(this._origins[i], p).free < 1) return false;
    return true;
  }

  // Parapet lift (see top): the lift that carries the line from the chest to the camera over
  // a low wall close to the hero while the camera is out over a drop, or 0.
  _parapetLift(eye, chest, desired, hero) {
    const below = this.collision.findFloor(desired.x, hero.y, desired.z);
    if (!below.surface || hero.y - below.y < PARAPET_DROP) return 0;
    const s = this._sightRay(chest, desired, undefined, this._parapetRay);
    if (!s.surface || s.surface.kind !== 'wall' || s.surface.maxY > hero.y + HEAD_TOP) return 0;
    const px = s.point.x - chest.x;
    const pz = s.point.z - chest.z;
    if (px * px + pz * pz > PARAPET_REACH * PARAPET_REACH) return 0;
    const hx = desired.x - eye.x;
    const hz = desired.z - eye.z;
    const room = LIFT_MAX_PITCH - Math.atan2(desired.y - eye.y, Math.sqrt(hx * hx + hz * hz));
    if (room <= 0) return 0;
    const lift = this._liftOver(eye, desired, s, 0, room);
    return lift <= room ? lift : 0;
  }

  // Smallest pitch lift (at most maxLift, never past LIFT_MAX_PITCH) after which no sight line
  // is blocked, or 0 if there is none. Each round lifts the camera just enough for the tightest
  // blocked line to pass over the top of the surface it hit, then re-tests every line.
  _clearingLift(eye, origins, desired, blocked, maxLift) {
    const hx = desired.x - eye.x;
    const hz = desired.z - eye.z;
    const pitch0 = Math.atan2(desired.y - eye.y, Math.sqrt(hx * hx + hz * hz));
    const room = Math.min(maxLift, LIFT_MAX_PITCH - pitch0);
    let lift = 0;
    for (let round = 0; round < LIFT_ROUNDS && room > 0; round++) {
      // `blocked` is a scratch sight record: it is read here, before the fans below reuse it.
      lift = this._liftOver(eye, desired, blocked, lift, room);
      if (lift > room) return 0;
      const p = this._liftPoint(eye, desired, lift, false, this._liftP);
      blocked = null;
      for (let i = 0; i < this._originCount; i++) {
        const f = this._fan(origins[i], p);
        if (f.free < 1) {
          blocked = f;
          break;
        }
      }
      if (!blocked) return lift;
    }
    return 0;
  }

  // Smallest lift in [lift, room] at which the sight line `f` (from f.from toward the lifted
  // camera) passes LIFT_CLEARANCE over the top of the surface it hit; Infinity if none does.
  // Lifting only raises that line, so a bisection finds it.
  _liftOver(eye, desired, f, lift, room) {
    const from = f.from;
    const top = f.surface.maxY + LIFT_CLEARANCE;
    const px = f.point.x - from.x;
    const pz = f.point.z - from.z;
    const reach = Math.sqrt(px * px + pz * pz);
    if (reach < 1 || !this._liftClears(eye, desired, from, reach, top, room)) return Infinity;
    // Hit below its own top: nudge up.
    if (this._liftClears(eye, desired, from, reach, top, lift)) return Math.min(room, lift + LIFT_NUDGE);
    let lo = lift;
    let hi = room;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if (this._liftClears(eye, desired, from, reach, top, mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  // Whether the line from `from` to the camera lifted by `l` passes `top` at horizontal
  // distance `reach` from `from`.
  _liftClears(eye, desired, from, reach, top, l) {
    const c = this._liftPoint(eye, desired, l, true, this._liftC);
    const cx = c.x - from.x;
    const cz = c.z - from.z;
    const camReach = Math.sqrt(cx * cx + cz * cz);
    return camReach > reach && from.y + ((c.y - from.y) * reach) / camReach >= top;
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
    for (let radius = WALL_RADIUS; radius >= WALL_RADIUS / 2; radius /= 2) {
      const pushed = this.collision.findWalls(out.x, out.y, out.z, 0, radius);
      const dx = pushed.x - out.x;
      const dz = pushed.z - out.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.01) return;
      // Pushed further than the radius: the camera is behind a wall's plane (past the end of a
      // thin wall or pillar), not in front of it. Never shove it through.
      if (d > radius + PUSH_SLACK) continue;
      const ray = this._ray;
      ray.x = dx;
      ray.y = 0;
      ray.z = dz;
      if (!this.collision.raycast(out, ray, d, WALLS_ONLY)) {
        out.x += dx;
        out.z += dz;
        return;
      }
    }
  }

  // What the straight line from `o` (a point on the hero) to the camera at p hits (a raycast
  // result), or null; hits within SEE_TOL of the camera do not count.
  _lineHit(o, p) {
    const d = this._ray;
    d.x = p.x - o.x;
    d.y = p.y - o.y;
    d.z = p.z - o.z;
    const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    return len <= SEE_TOL ? null : this.collision.raycast(o, d, len - SEE_TOL);
  }

  // Moves the eased ratio toward the soft limit: spring in, hold, then ease out.
  _ease(soft, omega, len, maxPull) {
    if (this.ratioFresh) {
      this.ratioFresh = false;
      this.ratio = soft;
      return;
    }
    if (soft < this.ratio) {
      // Critically damped spring toward the tighter distance (exact one-tick step).
      const e = this.ratio - soft;
      const k = this.ratioVel + omega * e;
      const decay = Math.exp(-omega);
      const next = soft + (e + k) * decay;
      const floor = this.ratio - maxPull / len;
      this.ratioVel = next < floor ? floor - this.ratio : (this.ratioVel - omega * k) * decay;
      this.ratio = Math.max(next, floor);
      this.clearTicks = 0;
      return;
    }
    // Hold, then ease back out (speed and acceleration limited). No hold while trapped.
    this.clearTicks = soft - this.ratio < HOLD_EPS ? 0 : this.clearTicks + 1;
    if (this.clearTicks <= HOLD_TICKS && !this.trapped) {
      this.ratioVel = 0;
      return;
    }
    const want = Math.min((soft - this.ratio) * RELEASE_RATE, RELEASE_MAX_SPEED / len);
    this.ratioVel = Math.min(want, Math.max(0, this.ratioVel) + RELEASE_ACCEL / len);
    this.ratio += this.ratioVel;
  }

  // How far along the ray the camera may extend: up to the first surface while in front of
  // it, or up to the next one while it is already beyond it (behind an occluder it reached
  // without tunnelling). Right after a reset there is no path: only a blocker that hides the
  // hero (`wide`) pulls the camera in front of it.
  _reachLimit(eye, dir, len, front, wide) {
    if (!this.last || this.ratioFresh) return wide ? front : 1;
    const r = Math.min(this.ratio, 1);
    if (r <= front) return front;
    const p = this._reachP;
    p.x = eye.x + dir.x * r * len;
    p.y = eye.y + dir.y * r * len;
    p.z = eye.z + dir.z * r * len;
    const ahead = this.collision.raycast(p, dir, (1 - r) * len + PAD, NO_FLOORS);
    return ahead ? Math.max(0, r * len + ahead.distance - PAD) / len : 1;
  }

  // Line of sight from `from` to `to`, written into the sight record `out`: free fraction
  // (1 = nothing in the way), and the surface and point it hit. `hit` passes in a ray already
  // cast along the same line (null: it hit nothing; undefined: cast one now).
  _sightRay(from, to, hit, out) {
    out.from = from;
    out.free = 1;
    out.surface = null;
    const d = this._ray;
    d.x = to.x - from.x;
    d.y = to.y - from.y;
    d.z = to.z - from.z;
    const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    if (len < 1) return out;
    if (hit === undefined) hit = this.collision.raycast(from, d, len);
    if (!hit || hit.distance >= len) return out;
    out.free = hit.distance / len;
    out.surface = hit.surface;
    out.point.x = hit.point.x;
    out.point.y = hit.point.y;
    out.point.z = hit.point.z;
    return out;
  }

  // Line of sight sampled by a centre ray (`centre`: already cast) and one ray starting
  // FAN_OFFSET to either side of the origin (all converging on `to`). The loosest counts: a
  // blocker has to cover the whole fan (wider than ~150 units) to hide the hero. The side
  // starts are computed once per tick per origin (resolve clears `sidesValid`); the result is
  // one of the origin's sight records.
  _fan(origin, to, centre) {
    let best = centre ?? this._sightRay(origin, to, undefined, origin.rays[0]);
    if (best.free >= 1) return best;
    if (!origin.sidesValid) this._sideOrigins(origin, to);
    for (let i = 0; i < origin.sideCount; i++) {
      best = looser(best, this._sightRay(origin.sides[i], to, undefined, origin.rays[i + 1]));
      if (best.free >= 1) break;
    }
    return best;
  }

  // Side ray starts: FAN_OFFSET left and right of the origin, across the horizontal direction
  // to `to`, pulled in when a surface is closer (a ray must not start behind a wall) and
  // dropped when there is no room. Written into origin.sides / sideCount.
  _sideOrigins(origin, to) {
    origin.sidesValid = true;
    origin.sideCount = 0;
    const dx = to.x - origin.x;
    const dz = to.z - origin.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    if (h < 1) return;
    const side = this._ray;
    for (let s = -1; s <= 1; s += 2) {
      const sx = (dz / h) * s;
      const sz = (-dx / h) * s;
      side.x = sx;
      side.y = 0;
      side.z = sz;
      const hit = this.collision.raycast(origin, side, FAN_OFFSET + PAD);
      const off = hit ? hit.distance - PAD : FAN_OFFSET;
      if (off < FAN_OFFSET / 2) continue;
      const o = origin.sides[origin.sideCount++];
      o.x = origin.x + sx * off;
      o.y = origin.y;
      o.z = origin.z + sz * off;
    }
  }

  // Where the hero's chest will be a few ticks from now (null while it stands still), written
  // into `out`. The extrapolated point is stopped in front of any surface on the way (the hero
  // will not pass through it) and lifted onto the floor when it ends up under a rising slope.
  _predictedChest(hero, out) {
    let px = (hero.velX || 0) * PREDICT_TICKS;
    let py = (hero.velY || 0) * PREDICT_TICKS;
    let pz = (hero.velZ || 0) * PREDICT_TICKS;
    const plen = Math.sqrt(px * px + py * py + pz * pz);
    if (plen < 1) return null;
    out.sidesValid = false;
    out.x = hero.x;
    out.y = hero.y + CHEST_HEIGHT;
    out.z = hero.z;
    const ray = this._ray;
    ray.x = px;
    ray.y = py;
    ray.z = pz;
    const probe = this.collision.raycast(out, ray, plen + PAD);
    if (probe) {
      const k = Math.max(0, probe.distance - PAD) / plen;
      px *= k;
      py *= k;
      pz *= k;
    }
    out.x += px;
    out.y += py;
    out.z += pz;
    const floor = this.collision.findFloor(out.x, out.y, out.z, PREDICT_FLOOR_TOL).y;
    if (floor > FLOOR_LOWER_LIMIT) out.y = Math.max(out.y, floor + CHEST_HEIGHT);
    return out;
  }

  // Floor under a camera position. It is searched from last tick's height too: sinking with a
  // diving hero must not carry the camera through the ground it was above.
  _floorBelow(p) {
    return this.collision.findFloor(p.x, Math.max(p.y, this.last?.y ?? p.y), p.z, FLOOR_QUERY_TOL).y;
  }

  _limitHeight(out, hero) {
    const submerged = !!(hero.submerged || hero.covered);
    const col = this.collision;
    const rawY = out.y;
    const floorY = this._floorBelow(out);
    const ceilY = col.findCeil(out.x, rawY, out.z, CEIL_QUERY_TOL).y;
    const water = col.waterLevelAt(out.x, out.z);
    const hasFloor = floorY > FLOOR_LOWER_LIMIT;
    const hasWater = water !== NO_WATER;

    let lo = hasFloor ? floorY + (submerged ? FLOOR_CLEARANCE : this._floorClearance(out, floorY, hero)) : -Infinity;
    let hi = ceilY < CEIL_NONE ? ceilY - CEIL_CLEARANCE : Infinity;
    if (hasWater) {
      if (submerged) hi = Math.min(hi, water - WATER_MARGIN);
      else lo = Math.max(lo, water + WATER_MARGIN);
    }
    // The floor wins over the water/ceiling limits when they conflict.
    let wanted = Math.max(Math.min(rawY, hi), lo);
    // Rise over a crest hiding the hero's feet (dry land only), up to any ceiling.
    this.crest.ease(hero.inWater ? 0 : this.crest.needed(hero, out.x, wanted, out.z));
    const crest = Math.max(0, Math.min(this.crest.rise, hi - wanted));
    wanted += crest;
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
    // Never poke through the surface: above it the camera stays above, below it below.
    if (hasWater && !submerged && !this.wasUnderwater) y = Math.max(y, water + WATER_HARD_MARGIN);
    if (hasWater && submerged && this.wasUnderwater) y = Math.min(y, water - WATER_HARD_MARGIN);
    out.y = y;
    // (The crest's share tips the view down to the hero rather than raising the aim.)
    this.heightLift = Math.max(0, y - rawY - crest);
    this.wasUnderwater = hasWater && y < water;
  }

  // Clearance over the floor at floorY under the camera at p (see SLOPE_CLEARANCE).
  _floorClearance(p, floorY, hero) {
    const dx = hero.x - p.x;
    const dz = hero.z - p.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    const probe = Math.min(SLOPE_PROBE, h / 2);
    if (probe < 1) return FLOOR_CLEARANCE;
    const k = probe / h;
    const ahead = this.collision.findFloor(p.x + dx * k, floorY, p.z + dz * k, FLOOR_QUERY_TOL).y;
    const fall = (floorY - ahead) / probe;
    if (!(fall > 0)) return FLOOR_CLEARANCE;
    const open = smooth(fall / SLOPE_FULL) * (1 - smooth((fall - SLOPE_EDGE[0]) / (SLOPE_EDGE[1] - SLOPE_EDGE[0])));
    return FLOOR_CLEARANCE - (FLOOR_CLEARANCE - SLOPE_CLEARANCE) * open;
  }

  // Cramped spots (a wall right behind the hero, a pier underwater): the closer the camera is
  // to the hero horizontally, the higher above it it must be, ramping smoothly from chest
  // height BODY_RAMP away to BODY_CLEARANCE over the head straight above it (which keeps it
  // BODY_CLEARANCE from the chest-to-head segment). Further out the limit keeps falling at
  // 45 deg (a camera under the surface may look up at a swimmer from there). Being continuous,
  // this never jumps. If a ceiling stops the climb inside the body, insideHero asks the game
  // to hide the model.
  _clearBody(out, hero) {
    const hx = out.x - hero.x;
    const hz = out.z - hero.z;
    const h = Math.sqrt(hx * hx + hz * hz);
    const k = Math.max(0, 1 - (h / BODY_RAMP) ** 2);
    const minY = hero.y + CHEST_HEIGHT + (h < BODY_RAMP ? (HEAD_TOP + BODY_CLEARANCE - CHEST_HEIGHT) * k : BODY_RAMP - h);
    if (out.y < minY) {
      const ceilY = this.collision.findCeil(out.x, out.y, out.z, CEIL_QUERY_TOL).y;
      out.y = Math.max(out.y, Math.min(minY, ceilY - CEIL_CLEARANCE));
    }
    const dy = out.y - Math.min(Math.max(out.y, hero.y + CHEST_HEIGHT), hero.y + HEAD_TOP);
    this.insideHero = h * h + dy * dy < BODY_MIN * BODY_MIN;
  }

  // Orbit yaw nearest to `yaw` (in RESET_YAW_STEP steps) whose ray from `target` is clear for
  // the full distance, or the one with the most room: where a reset places the camera when
  // the spot behind the hero is walled in.
  openYaw(target, yaw, pitch, dist) {
    let bestYaw = yaw;
    let bestRoom = -1;
    const cp = Math.cos(pitch);
    const dir = this._ray;
    for (let i = 0; i <= 180 / RESET_YAW_DEG; i++) {
      const both = i !== 0 && i * RESET_YAW_DEG !== 180;
      for (let s = 1; s >= (both ? -1 : 1); s -= 2) {
        const y = yaw + s * i * RESET_YAW_DEG * DEG;
        dir.x = Math.sin(y) * cp;
        dir.y = Math.sin(pitch);
        dir.z = Math.cos(y) * cp;
        const hit = this.collision.raycast(target, dir, dist);
        if (!hit) return y;
        if (hit.distance > bestRoom) {
          bestYaw = y;
          bestRoom = hit.distance;
        }
      }
    }
    return bestYaw;
  }

  // Whether nothing lies on the straight line from `a` to `b`.
  lineClear(a, b) {
    const d = this._ray;
    d.x = b.x - a.x;
    d.y = b.y - a.y;
    d.z = b.z - a.z;
    const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    return len < 1 || !this.collision.raycast(a, d, len);
  }

  // Whether the whole hero is in view from p: lines from several points on his body (his centre
  // line from hips to head, and HERO_SIDE either side of his chest across the view) are all
  // clear. Unlike the sight fan (which lets posts and trunks pass in front of him), a thin
  // post covering half of him counts.
  heroInView(hero, p) {
    const o = this._heroPt;
    o.x = hero.x;
    o.z = hero.z;
    for (let i = 0; i < HERO_POINTS.length; i++) {
      o.y = hero.y + HERO_POINTS[i];
      if (!this.lineClear(o, p)) return false;
    }
    const dx = p.x - hero.x;
    const dz = p.z - hero.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    if (h < 1) return true;
    o.y = hero.y + CHEST_HEIGHT;
    for (let s = -1; s <= 1; s += 2) {
      o.x = hero.x + (dz / h) * HERO_SIDE * s;
      o.z = hero.z - (dx / h) * HERO_SIDE * s;
      if (!this.lineClear(o, p)) return false;
    }
    return true;
  }

  // Orbit yaw nearest to `yaw` (steps as clearYaw) from which the whole hero is in view
  // (heroInView) from the point `dist` out horizontally at height y, or null.
  clearHeroYaw(hero, yaw, dist, y, step, maxTurn) {
    const p = this._heroAt;
    for (let i = 0; i * step <= maxTurn + 1e-6; i++) {
      for (let s = 1; s >= (i ? -1 : 1); s -= 2) {
        const a = yaw + s * i * step;
        p.x = hero.x + Math.sin(a) * dist;
        p.y = y;
        p.z = hero.z + Math.cos(a) * dist;
        if (this.heroInView(hero, p)) return a;
      }
    }
    return null;
  }

  // Orbit yaw nearest to `yaw` (steps of `step`, alternating sides, up to `maxTurn` away) whose
  // line from `from` to the point `dist` out horizontally at height y is clear, or null.
  clearYaw(from, yaw, dist, y, step, maxTurn) {
    const p = this._liftC;
    for (let i = 0; i * step <= maxTurn + 1e-6; i++) {
      for (let s = 1; s >= (i ? -1 : 1); s -= 2) {
        const a = yaw + s * i * step;
        p.x = from.x + Math.sin(a) * dist;
        p.y = y;
        p.z = from.z + Math.cos(a) * dist;
        if (this.lineClear(from, p)) return a;
      }
    }
    return null;
  }

  // Clear distance (up to dist) from `target` along the orbit direction yaw/pitch.
  room(target, yaw, pitch, dist) {
    const cp = Math.cos(pitch);
    const dir = this._ray;
    dir.x = Math.sin(yaw) * cp;
    dir.y = Math.sin(pitch);
    dir.z = Math.cos(yaw) * cp;
    const hit = this.collision.raycast(target, dir, dist);
    return hit ? hit.distance : dist;
  }

  // True when rotating the orbit to `yaw` would put the camera hard against a wall.
  rotationBlocked(target, yaw, pitch, dist, minDist) {
    const cp = Math.cos(pitch);
    const dir = this._ray;
    dir.x = Math.sin(yaw) * cp;
    dir.y = Math.sin(pitch);
    dir.z = Math.cos(yaw) * cp;
    const hit = this.collision.raycast(target, dir, dist, WALLS_ONLY);
    return !!hit && hit.distance < minDist;
  }
}

function dist3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Occlusion alone never brings the camera closer than this to the hero...
function softMin(len) {
  return Math.max(SOFT_MIN_DIST, SOFT_MIN_FRACTION * len);
}

// ...or than this while tolerant (the flight camera).
function tolerantMin(len) {
  return Math.max(TOLERANT_MIN_DIST, TOLERANT_MIN_FRACTION * len);
}

// Horizontal speed of the hero record (units/tick).
function heroSpeed(hero) {
  if (hero.speed !== undefined) return hero.speed;
  const vx = hero.velX || 0;
  const vz = hero.velZ || 0;
  return Math.sqrt(vx * vx + vz * vz);
}

// Smooth 0..1 ramp of t (clamped).
function smooth(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// The less blocked of two sight samples.
function looser(a, b) {
  return b.free > a.free ? b : a;
}
