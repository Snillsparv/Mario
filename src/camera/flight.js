// Winged-hat flight camera (cameraConfig FLY_*). While the hero flies (action 'flying') the
// orbit becomes a flight-follow camera: it swings to straight behind his heading at an eased turn
// rate (fairly quick but smooth, with a touch of lag in a banked turn), trails at FLY_DIST and
// partly follows his flight pitch (RenderState / Player `pitch`, > 0 nose down): looking down on
// him in a dive, level-ish behind him in a climb. CameraController blends every setting between
// the follow camera and this one by `w` (0..1), which eases in over FLY_IN_TICKS at take-off and
// back out over FLY_OUT_TICKS once the flight ends, so the hand-back never pops; its vertical
// framing follows him closely meanwhile (no jump band), and its collider is `tolerant`. A flight
// camera a wall stops or pulls in rises over it (`rise`, FLY_RISE_*: an eased extra pitch).
// Room (FLY_ROOM_*): the swing only goes as far round as the camera has room. Probing orbit
// positions from where it is toward straight behind him, it stops FLY_ROOM_MARGIN short of the
// first one without room: a wall within FLY_ROOM_CLEAR of it, a roof or a slope right under it,
// or its view ray cut short by a tall, wide blocker (the castle facade, a tower, a cliff; not a
// trunk). One that has room only with the orbit risen FLY_RISE (a rooftop tower, a crest) counts,
// and the rise comes up ahead of it. So a hero turning away from the castle close to it keeps the
// camera beside him, out in the open, and it comes round behind him as he flies clear (instead of
// being swung into the facade, scraped along it and lifted into the balcony); when the way round
// toward behind him stays shut and the other way is open, it goes that way. A swing under way
// keeps its direction while its way has room, speeds up gently (FLY_SWING_ACCEL) and slows down
// in time (FLY_SWING_BRAKE). An orbit position without room turns to the nearest one that has.
//
// State for CameraController (numbers only: no per-tick garbage).

import { angleDiff, clamp } from '../core/math.js';
import { smootherstep } from './cinematics.js';
import * as K from './cameraConfig.js';

const NO_FLOORS = Object.freeze({ floors: false }); // (the height limit carries the camera over floors)
const FLOOR_TOL = 1000; // (a roof or a slope this far over an orbit position counts)

export class FlightCam {
  // `collision` (optional): the level, for the room probes (none: the swing is not limited).
  constructor(collision = null) {
    this.collision = collision;
    this._from = { x: 0, y: 0, z: 0 }; // room probe scratch
    this._dir = { x: 0, y: 0, z: 0 };
    this.probes = 0; // room queries (spots and rays) this tick (diagnostics)
    this.reset(false, K.ORBIT_MODES.follow.pitch[0], 0);
  }

  // `flying`: the hero is in flight right now (the camera starts as the flight camera);
  // `orbitPitch`: the orbit's pitch; `heroPitch`: his flight pitch.
  reset(flying, orbitPitch, heroPitch) {
    this.flying = flying; // the hero flew last tick
    this.t = flying ? 1 : 0; // blend progress (linear)...
    this.w = flying ? 1 : 0; // ...and the eased weight of the flight camera
    this.pitch = flying ? flightPitch(heroPitch) : orbitPitch; // eased orbit pitch of the flight camera
    this.rate = 0; // eased yaw rate of the swing behind him
    this.rise = 0; // eased extra pitch over an obstacle...
    this.clearTicks = 0; // ...held this many ticks after it is clear
    this.roomy = true; // the swing went all the way round to behind him (no room limit this tick)
    this.liftAhead = false; // the way it swings has room only once risen (the rise comes up)
    this.reachLift = false; // (_reach scratch: the way it walked needed the rise)
  }

  // Advances one tick (before the orbit uses mix / swing). `collider` holds last tick's
  // obstruction (slid, ratio). Returns true on take-off.
  update(hero, orbitPitch, collider) {
    const flying = K.FLY_ACTION.test(hero.action);
    const started = flying && !this.flying;
    this.flying = flying;
    this.t = flying ? Math.min(1, this.t + 1 / K.FLY_IN_TICKS) : Math.max(0, this.t - 1 / K.FLY_OUT_TICKS);
    this.w = smootherstep(this.t);
    // The flight pitch starts from the orbit's and follows his while he flies; after the flight it
    // holds while the blend hands back to the follow camera's.
    if (this.w === 0) this.pitch = orbitPitch;
    else if (flying) this.pitch += (flightPitch(hero.pitch) - this.pitch) * K.FLY_PITCH_RATE;
    // Rising over an obstacle while flying (see top).
    const blocked = flying && (collider.slid || collider.ratio < K.FLY_RISE_RATIO || this.liftAhead);
    this.liftAhead = false; // (consumed: set again by this tick's swing, if the swing runs)
    this.clearTicks = blocked ? 0 : this.clearTicks + 1;
    if (blocked) this.rise += (K.FLY_RISE - this.rise) * K.FLY_RISE_IN;
    else if (this.clearTicks > K.FLY_RISE_HOLD || !flying) this.rise -= this.rise * K.FLY_RISE_OUT;
    if (this.w === 0) this.rise = 0;
    return started;
  }

  // Orbit pitch of the flight camera this tick.
  get orbitPitch() {
    return this.pitch + this.rise;
  }

  // `normal` blended toward `flight` by the flight camera's weight (exactly `normal` at w = 0).
  mix(normal, flight) {
    return normal + (flight - normal) * this.w;
  }

  // Yaw turn this tick toward straight behind the hero's heading from the orbit yaw `yaw` (an
  // eased rate, weighted by w), as far as the camera has room (see top: `centre` is the orbit
  // centre, `pitch` and `dist` the orbit's; without them the room is not checked). Once the flight
  // is over the rate eases out. A swing under way keeps its direction past FLY_SWING_KEEP (he
  // turned to face the camera), or while the way it goes has room and is not much longer
  // (FLY_ROOM_KEEP), so it does not dither about which way round to go or turn back half way.
  swing(hero, yaw, centre = null, pitch = 0, dist = 0) {
    this.probes = 0;
    this.roomy = true;
    this.liftAhead = false;
    if (this.w === 0) {
      this.rate = 0;
      return 0;
    }
    let goal = 0;
    if (this.flying) {
      const room = !!(centre && this.collision);
      let d = angleDiff(yaw, hero.faceYaw + Math.PI);
      if (this.rate * d < 0) {
        const other = d - Math.sign(d) * 2 * Math.PI;
        if (Math.abs(d) > K.FLY_SWING_KEEP) d = other;
        else if (room && Math.abs(this.rate) > K.FLY_ROOM_KEEP_RATE && Math.abs(other) < Math.abs(d) + K.FLY_ROOM_KEEP) {
          if (this._reach(yaw, Math.sign(other), Math.abs(other), centre, pitch, dist) === Infinity) d = other;
        }
      }
      if (room) d = this._room(yaw, d, centre, pitch, dist);
      goal = clamp(d * K.FLY_SWING_GAIN, -K.FLY_SWING_MAX, K.FLY_SWING_MAX);
    }
    // Eased toward the goal, speeding up by at most FLY_SWING_ACCEL per tick (a long swing starts
    // gently) and slowing down by at most FLY_SWING_BRAKE (it ends gently, yet stops in time).
    const want = this.rate + (goal - this.rate) * K.FLY_SWING_EASE;
    const r = this.rate;
    if (want * r < 0) {
      this.rate = Math.abs(r) > K.FLY_SWING_BRAKE ? r - Math.sign(r) * K.FLY_SWING_BRAKE : clamp(want, -K.FLY_SWING_ACCEL, K.FLY_SWING_ACCEL);
    } else if (Math.abs(want) > Math.abs(r)) this.rate = r + clamp(want - r, -K.FLY_SWING_ACCEL, K.FLY_SWING_ACCEL);
    else this.rate = r + clamp(want - r, -K.FLY_SWING_BRAKE, K.FLY_SWING_BRAKE);
    return this.rate * this.w;
  }

  // The swing `d` (from the orbit yaw `yaw` toward behind him) limited to the room (see top). The
  // way round toward the goal is walked (_reach) and the swing stops FLY_ROOM_MARGIN short of the
  // first yaw without room (it backs off when the camera is closer than that to it); the limit
  // moves smoothly with the hero, so the swing does too. When that leaves the camera far from
  // behind him (FLY_ROOM_LONG) and the other way round gets it much closer (FLY_ROOM_BETTER: he
  // turned away from the wall and on round, and the open side is behind him now), it goes that
  // way. An orbit position without room turns to the nearest yaw that has (_escape), if any.
  _room(yaw, d, centre, pitch, dist) {
    const s = d < 0 ? -1 : 1;
    const a = Math.abs(d);
    const near = this._reach(yaw, s, a, centre, pitch, dist);
    this.liftAhead = this.reachLift;
    if (near === Infinity) return d;
    this.roomy = false;
    if (near < 0) {
      const e = this._escape(yaw, s, centre, pitch, dist);
      this.liftAhead = e !== null && this.reachLift;
      return e ?? d;
    }
    const nearGo = Math.min(a, near - K.FLY_ROOM_MARGIN);
    const nearLeft = a - nearGo;
    if (nearLeft > K.FLY_ROOM_LONG) {
      const nearLift = this.liftAhead;
      const b = 2 * Math.PI - a;
      const far = this._reach(yaw, -s, b, centre, pitch, dist);
      const farGo = far === Infinity ? b : Math.min(b, far - K.FLY_ROOM_MARGIN);
      if (b - farGo < nearLeft - K.FLY_ROOM_BETTER) {
        this.liftAhead = this.reachLift;
        return -s * farGo;
      }
      this.liftAhead = nearLift;
    }
    return s * nearGo;
  }

  // How far round (radians) from `yaw` in direction `s` the camera has room, walking to
  // FLY_ROOM_MARGIN past `a` in steps of at most FLY_ROOM_STEP (a short arc, as in a straight
  // flight, by its far end alone) and narrowing the first yaw without room down to FLY_ROOM_EDGE
  // by bisection: Infinity if it has room all the way, -1 if not even at `yaw`.
  _reach(yaw, s, a, centre, pitch, dist) {
    const span = a + K.FLY_ROOM_MARGIN;
    const n = Math.min(K.FLY_ROOM_PROBES, Math.ceil(span / K.FLY_ROOM_STEP));
    let open = 0;
    let shut = -1;
    let lift = false;
    for (let k = n <= 2 ? n : 0; k <= n; k++) {
      const t = (span * k) / n;
      const room = this._open(yaw, s * t, centre, pitch, dist);
      if (!room) {
        shut = t;
        break;
      }
      if (room === 2) lift = true;
      open = t;
    }
    this.reachLift = lift;
    if (shut < 0) return Infinity;
    if (shut === 0) return -1;
    for (let i = 0; i < 8 && shut - open > K.FLY_ROOM_EDGE; i++) {
      const mid = (open + shut) / 2;
      const room = this._open(yaw, s * mid, centre, pitch, dist);
      if (room === 2) this.reachLift = true;
      if (room) open = mid;
      else shut = mid;
    }
    return open;
  }

  // The orbit position has no room (his motion carried it into a wall, or it was dollied in
  // front of one): the swing to the nearest yaw that has (FLY_ROOM_ESCAPE_STEP steps either way,
  // the side `s` toward the goal first, up to FLY_ROOM_ESCAPE; no margin, so it cannot overshoot
  // into the next blocker), or null where there is none (in among the towers on the roofs: the
  // swing then goes behind him as ever, and the collider copes).
  _escape(yaw, s, centre, pitch, dist) {
    for (let t = K.FLY_ROOM_ESCAPE_STEP; t <= K.FLY_ROOM_ESCAPE + 1e-6; t += K.FLY_ROOM_ESCAPE_STEP) {
      for (let k = s; k === s || k === -s; k = k === s ? -s : 0) {
        const room = this._open(yaw, k * t, centre, pitch, dist);
        if (room) {
          this.reachLift = room === 2;
          return k * t;
        }
      }
    }
    return null;
  }

  // Whether the orbit position at yaw + `off` (pitch, dist from `centre`) has room for the camera:
  // 1 when it is clear of walls and floors (_spot: not grazing a tower it passes, over a pointed
  // roof or inside a building) and its ray is clear for the whole distance (plus FLY_ROOM_PAD), or
  // a ray FLY_ROOM_SIDE to either side is (the centre one hit a trunk or a post, which the collider
  // lets pass); 2 when that holds only with the orbit lifted FLY_RISE (a rooftop tower, a wall or
  // a crest the flight camera rises over); 0 when it has no room.
  _open(yaw, off, centre, pitch, dist) {
    const a = yaw + off;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    const reach = dist + K.FLY_ROOM_PAD;
    if (this._spot(centre, sa, ca, pitch, dist)) {
      if (this._clear(centre, sa, ca, pitch, 0, reach)) return 1;
      if (this._clear(centre, sa, ca, pitch, -K.FLY_ROOM_SIDE, reach) || this._clear(centre, sa, ca, pitch, K.FLY_ROOM_SIDE, reach)) return 1;
    }
    const lifted = pitch + K.FLY_RISE;
    return this._spot(centre, sa, ca, lifted, dist) && this._clear(centre, sa, ca, lifted, 0, reach) ? 2 : 0;
  }

  // Whether the orbit position along the yaw with sine `sa` / cosine `ca` and `pitch`, `dist` from
  // `centre`, is FLY_ROOM_CLEAR from any wall, at least FLY_ROOM_FLOOR over the floor there (where
  // the height limit puts it), and the floor there would not lift it more than FLY_ROOM_BUMP (a
  // roof, a tower's cone or a slope right there, or it is inside a building).
  _spot(centre, sa, ca, pitch, dist) {
    this.probes++;
    const col = this.collision;
    const cp = Math.cos(pitch);
    const x = centre.x + sa * cp * dist;
    const z = centre.z + ca * cp * dist;
    const y = centre.y + Math.sin(pitch) * dist;
    const lift = col.findFloor(x, y, z, FLOOR_TOL).y + K.FLY_ROOM_FLOOR - y;
    if (lift > K.FLY_ROOM_BUMP) return false;
    return col.findWalls(x, y + Math.max(0, lift), z, 0, K.FLY_ROOM_CLEAR).walls.length === 0;
  }

  // One room ray: along the yaw with sine `sa` / cosine `ca` and `pitch` from `centre` moved
  // `side` across it, clear (of walls and ceilings) for `reach`.
  _clear(centre, sa, ca, pitch, side, reach) {
    this.probes++;
    const from = this._from;
    from.x = centre.x + ca * side;
    from.y = centre.y;
    from.z = centre.z - sa * side;
    const dir = this._dir;
    const cp = Math.cos(pitch);
    dir.x = sa * cp;
    dir.y = Math.sin(pitch);
    dir.z = ca * cp;
    return !this.collision.raycast(from, dir, reach, NO_FLOORS);
  }
}

// Orbit pitch of the flight camera for the hero's flight pitch (> 0 nose down).
function flightPitch(heroPitch) {
  return clamp(K.FLY_PITCH_BASE + (heroPitch || 0) * K.FLY_PITCH_FOLLOW, K.FLY_PITCH_MIN, K.FLY_PITCH_MAX);
}
