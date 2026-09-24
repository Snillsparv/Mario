// Butterflies: pairs of flapping, alpha-tested wing quads (all in one dynamic mesh) that wander
// lazily around their spot and flutter away when the hero gets close.
//
// They keep out of solid scenery: at startup each spot's wander disk is fitted into open air
// (shifted away from buildings if needed), every tick walls push them out and deflect a flight
// along the wall, and one that rises close under a roof flies back home.
//
// Once JIT-compiled, update() and animate() allocate nothing themselves: no Math.hypot or
// Math.max/min on doubles (V8 calls them out of line, boxing arguments and result), no
// iterators, no numbers passed to helpers that may not be inlined. The only per-tick garbage
// is the small result objects of the collision queries (CollisionWorld's contract) and the
// numbers boxed to pass to them: a staggered floor probe every PROBE_EVERY ticks per
// butterfly (plus a water query only over floors below `waterTop`), and a wall query per tick
// for one that has left its home's open-air radius.

import * as THREE from 'three';
import { makeWingAtlas, wingUV, WING_VARIANTS } from './textures.js';
import { TAU, clamp } from '../core/math.js';
import { FRAME_DT } from '../core/constants.js';

const PER_SPOT = 3;
const WING_W = 34; // hinge to tip
const WING_L = 42; // tail to head
const WANDER = 330; // largest wander radius around the spot
const MIN_WANDER = 220; // shift the wander centre (by up to HOME_SHIFTS) to get this much room
const HOME_SHIFTS = [150, 300, 450];
const CLEARANCE = 100; // the wander disk keeps this far from solid scenery
const GRID = 60; // scenery sampling step when fitting the disk
const ALT_MIN = 110; // wander altitude band above the ground
const ALT_MAX = 360;
const ALT_CEIL = 900; // never higher than this above the ground (fleeing climbs)
const WALL_PROBE_ALTS = [ALT_MIN, ALT_MAX, ALT_CEIL];
const FLEE_RADIUS = 400;
const FLEE_TICKS = 70;
const LEASH = 1600; // stop fleeing this far from home
const CRUISE_SPEED = 5; // units/tick
const FLEE_SPEED = 15;
const ACCEL = 0.7;
const BODY_RADIUS = 40; // pushed out of walls to this distance
const PROBE_EVERY = 8; // ticks between floor/roof probes (staggered per butterfly)
const WALL_MEMORY = 30; // ticks a touched wall keeps deflecting the flight
const HOMING_TICKS = 60;
const HEADROOM = 300; // a floor this close overhead sends the butterfly home
const TURN_RATE = 0.25; // rad/tick
const SKY = 1e5; // probe height for "anything built above this column?"
const PITCH_S = Math.sin(0.25); // nose up
const PITCH_C = Math.cos(0.25);

// Math.max / Math.min stand-ins for the per-tick path: V8's mid tier (Maglev) does not inline
// Math.max/min on doubles, so each call would box its arguments and result.
const higher = (a, b) => (a > b ? a : b);
const lower = (a, b) => (a < b ? a : b);

// Has butterfly b left its home's open-air radius (where walls may be within reach)?
function outsideClear(b) {
  const { pos, home } = b;
  const dx = pos.x - home.x;
  const dz = pos.z - home.z;
  return home.clear < 0 || dx * dx + dz * dz > home.clear * home.clear;
}

// Turns butterfly b toward its horizontal velocity by at most TURN_RATE (like core/math's
// approachAngle). Branch-free: V8's mid tier boxed the angles merged by approachAngle's
// branches (one allocation per call).
function faceVelocity(b) {
  const d = Math.atan2(b.vel.x, b.vel.z) - b.yaw;
  const wrapped = d - TAU * Math.round(d / TAU); // [-PI, PI]
  const turn = wrapped > TURN_RATE ? TURN_RATE : wrapped < -TURN_RATE ? -TURN_RATE : wrapped;
  const yaw = b.yaw + turn;
  b.yaw = yaw - TAU * Math.round(yaw / TAU);
}

export class Butterflies {
  // groundAt(x, z): analytic terrain height; collision: CollisionWorld (findFloor, findWalls,
  // waterLevelAt); waterTop: no water surface is higher than this (layout.WATER_LEVEL), so a
  // floor at or above it needs no water query.
  constructor(spots, { collision, groundAt, rng, waterTop = Infinity }) {
    this.collision = collision;
    this.groundAt = groundAt;
    this.waterTop = waterTop;
    this.list = [];
    this._target = { x: 0, y: 0, z: 0 };
    for (const spot of spots) {
      const home = this._fitHome(spot);
      for (let k = 0; k < PER_SPOT; k++) {
        const f = () => 0.12 + rng() * 0.22; // wander frequencies (rad/s)
        const p = () => rng() * TAU;
        const b = {
          home,
          freq: [f(), f(), f() * 2.3, f() * 1.7, f() * 1.5],
          phase: [p(), p(), p(), p(), p()],
          pos: { x: 0, y: 0, z: 0 },
          prev: { x: 0, y: 0, z: 0 },
          vel: { x: 0, y: 0, z: 0 },
          floor: home.floor, // floor (or water) under the butterfly, refreshed by _probe
          yaw: rng() * TAU,
          flee: 0,
          fleeDir: { x: 0, z: 0 },
          homing: 0,
          wall: { x: 0, z: 0, ticks: 0 }, // last wall touched (outward normal)
          side: rng() < 0.5 ? -1 : 1, // which way to slide along a wall when fleeing into it
          flap: rng() * TAU,
          variant: Math.floor(rng() * WING_VARIANTS),
        };
        this._wanderTarget(b, 0, b.pos);
        Object.assign(b.prev, b.pos);
        b.prevFlap = b.flap;
        this.list.push(b);
      }
    }
    this.mesh = this._buildMesh();
  }

  // Is the column at (x, z) unfit for butterflies flying `base` + [ALT_MIN, ALT_MAX]?
  // Something built stands there (a floor above the terrain) or a wall is within GRID.
  _blocked(x, z, base) {
    const c = this.collision;
    const terrain = this.groundAt(x, z);
    if (c.findFloor(x, SKY, z).y > terrain + 40) return true;
    const b = Math.max(base, terrain);
    for (const alt of WALL_PROBE_ALTS) if (c.findWalls(x, b + alt, z, 0, GRID).walls.length) return true;
    return false;
  }

  // Wander centre and radius for a spot: the spot itself when it has WANDER room, else the
  // least-shifted centre with MIN_WANDER room (or the roomiest candidate). Also returns the
  // centre's open-air radius `clear`: no wall within reach inside it, so update() skips the
  // (allocating) wall queries there.
  _fitHome(spot) {
    const base = Math.max(this.groundAt(spot.x, spot.z), this.collision.waterLevelAt(spot.x, spot.z));
    const reach = HOME_SHIFTS[HOME_SHIFTS.length - 1] + WANDER + CLEARANCE;
    const blocked = [];
    for (let dx = -reach; dx <= reach; dx += GRID) {
      for (let dz = -reach; dz <= reach; dz += GRID) {
        if (this._blocked(spot.x + dx, spot.z + dz, base)) blocked.push(dx, dz);
      }
    }
    const room = (cx, cz) => {
      let r = WANDER;
      for (let i = 0; i < blocked.length; i += 2) r = Math.min(r, Math.hypot(blocked[i] - cx, blocked[i + 1] - cz) - CLEARANCE);
      return r;
    };
    const candidates = [[0, 0]];
    for (const d of HOME_SHIFTS) {
      for (let k = 0; k < 8; k++) candidates.push([Math.cos((k / 8) * TAU) * d, Math.sin((k / 8) * TAU) * d]);
    }
    let best = null;
    for (const [cx, cz] of candidates) {
      const r = room(cx, cz);
      if (!best || r > best.radius) best = { x: spot.x + cx, z: spot.z + cz, radius: r };
      if (r >= MIN_WANDER) break; // candidates are ordered by shift distance
    }
    best.radius = Math.max(GRID, best.radius);
    best.floor = Math.max(this.groundAt(best.x, best.z), this.collision.waterLevelAt(best.x, best.z));
    const ox = best.x - spot.x;
    const oz = best.z - spot.z;
    let clear = reach - Math.max(Math.abs(ox), Math.abs(oz)); // edge of the sampled square
    for (let i = 0; i < blocked.length; i += 2) clear = Math.min(clear, Math.hypot(blocked[i] - ox, blocked[i + 1] - oz));
    best.clear = clear - GRID - BODY_RADIUS;
    return best;
  }

  _buildMesh() {
    const n = this.list.length;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(n * 8 * 3);
    const posAttr = new THREE.BufferAttribute(this.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    const uv = [];
    const index = [];
    this.list.forEach((b, i) => {
      const [u0, v0, du, dv] = wingUV(b.variant);
      // Per wing: hinge-tail, hinge-head, tip-head, tip-tail (canvas top = head = v0 + dv).
      for (let w = 0; w < 2; w++) {
        uv.push(u0, v0, u0, v0 + dv, u0 + du, v0 + dv, u0 + du, v0);
        const o = (i * 2 + w) * 4;
        index.push(o, o + 1, o + 2, o, o + 2, o + 3);
      }
    });
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    const material = new THREE.MeshBasicMaterial({ map: makeWingAtlas(), alphaTest: 0.5, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  // Smooth Lissajous wander point around home at the given tick, written into out, at the
  // altitude band over the higher of the floor under the butterfly and its home's floor.
  // (Integer and object arguments only: doubles passed to a call that is not inlined get boxed.)
  _wanderTarget(b, tick, out) {
    const { home, freq: f, phase: p } = b;
    const t = tick * FRAME_DT;
    const base = higher(b.floor, home.floor);
    const r = home.radius;
    out.x = home.x + r * (0.72 * Math.sin(t * f[0] + p[0]) + 0.28 * Math.sin(t * f[2] + p[2]));
    out.z = home.z + r * (0.72 * Math.cos(t * f[1] + p[1]) + 0.28 * Math.sin(t * f[3] + p[3]));
    out.y = base + ALT_MIN + (ALT_MAX - ALT_MIN) * (0.5 + 0.5 * Math.sin(t * f[4] + p[4]));
  }

  // Refreshes the floor under a butterfly. Walls push it out sideways, but nothing stops it
  // rising into a low roof or deck from below, so one with a floor just overhead heads home
  // (only possible outside its home's open-air radius).
  _probe(b) {
    const { pos } = b;
    const floor = this.collision.findFloor(pos.x, pos.y, pos.z).y;
    b.floor = floor >= this.waterTop ? floor : higher(floor, this.collision.waterLevelAt(pos.x, pos.z));
    if (outsideClear(b) && this.collision.findFloor(pos.x, pos.y + HEADROOM, pos.z, 0).y > pos.y) {
      b.flee = 0;
      b.homing = HOMING_TICKS;
    }
  }

  // Pushes a butterfly out of walls and cancels its velocity into them.
  _pushOutOfWalls(b) {
    const { pos, vel, wall } = b;
    const w = this.collision.findWalls(pos.x, pos.y, pos.z, 0, BODY_RADIUS);
    if (!w.walls.length) return;
    pos.x = w.x;
    pos.z = w.z;
    const hn = w.walls[w.walls.length - 1].hn;
    const into = vel.x * hn.x + vel.z * hn.z;
    if (into < 0) {
      vel.x -= into * hn.x;
      vel.z -= into * hn.z;
    }
    wall.x = hn.x;
    wall.z = hn.z;
    wall.ticks = WALL_MEMORY;
  }

  // A butterfly fleeing into a recently touched wall slides along it instead.
  _deflectFlee(b) {
    const d = b.fleeDir;
    const w = b.wall;
    const into = d.x * w.x + d.z * w.z;
    if (into >= 0) return;
    d.x -= into * w.x;
    d.z -= into * w.z;
    const len = Math.sqrt(d.x * d.x + d.z * d.z);
    if (len < 0.35) {
      d.x = -w.z * b.side;
      d.z = w.x * b.side;
    } else {
      d.x /= len;
      d.z /= len;
    }
  }

  update(tick, hero) {
    const target = this._target;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const { pos, vel, prev, home } = b;
      prev.x = pos.x;
      prev.y = pos.y;
      prev.z = pos.z;
      b.prevFlap = b.flap;
      const ox = pos.x - home.x;
      const oz = pos.z - home.z;
      const fromHome = Math.sqrt(ox * ox + oz * oz);
      if ((tick + i) % PROBE_EVERY === 0) this._probe(b);

      const hx = pos.x - hero.x;
      const hz = pos.z - hero.z;
      const hd = Math.sqrt(hx * hx + hz * hz);
      if (b.homing === 0 && hd < FLEE_RADIUS && Math.abs(pos.y - hero.y) < FLEE_RADIUS + 200) {
        b.flee = FLEE_TICKS;
        b.fleeDir.x = hd > 1 ? hx / hd : Math.sin(b.yaw);
        b.fleeDir.z = hd > 1 ? hz / hd : Math.cos(b.yaw);
      }
      if (fromHome > LEASH) b.flee = 0;
      if (b.wall.ticks > 0) {
        b.wall.ticks--;
        if (b.flee > 0) this._deflectFlee(b);
      }

      // Fly at the home altitude over lower ground (e.g. out over the moat), follow higher ground.
      const base = higher(b.floor, home.floor);
      let maxSpeed = CRUISE_SPEED;
      if (b.homing > 0) {
        b.homing--;
        target.x = home.x;
        target.y = base + (ALT_MIN + ALT_MAX) / 2;
        target.z = home.z;
      } else if (b.flee > 0) {
        b.flee--;
        target.x = pos.x + b.fleeDir.x * 500;
        target.y = lower(pos.y + 250, base + 700);
        target.z = pos.z + b.fleeDir.z * 500;
        maxSpeed = FLEE_SPEED;
      } else {
        this._wanderTarget(b, tick, target);
      }

      // Steer toward the target with limited acceleration.
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dz = target.z - pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const speed = lower(maxSpeed, d * 0.06 + 0.5);
      const ax = (dx / d) * speed - vel.x;
      const ay = (dy / d) * speed - vel.y;
      const az = (dz / d) * speed - vel.z;
      const a = Math.sqrt(ax * ax + ay * ay + az * az);
      const k = a > ACCEL ? ACCEL / a : 1;
      vel.x += ax * k;
      vel.y += ay * k;
      vel.z += az * k;
      pos.x += vel.x;
      pos.y = clamp(pos.y + vel.y, b.floor + 60, base + ALT_CEIL);
      pos.z += vel.z;
      if (outsideClear(b)) this._pushOutOfWalls(b);

      if (vel.x * vel.x + vel.z * vel.z > 0.09) faceVelocity(b);
      b.flap += (b.flee > 0 ? 13 : 8) * TAU * FRAME_DT;
    }
  }

  animate(alpha) {
    const P = this.positions;
    const list = this.list;
    const half = WING_L / 2;
    let o = 0;
    for (let n = 0; n < list.length; n++) {
      const b = list[n];
      const flap = b.prevFlap + (b.flap - b.prevFlap) * alpha;
      const s = Math.sin(flap);
      const wing = 0.15 + 1.15 * (0.5 + 0.5 * s); // hinge angle above horizontal
      const fx = b.prev.x + (b.pos.x - b.prev.x) * alpha;
      const fy = b.prev.y + (b.pos.y - b.prev.y) * alpha - 5 * s; // body dips as the wings rise
      const fz = b.prev.z + (b.pos.z - b.prev.z) * alpha;
      const sy = Math.sin(b.yaw);
      const cy = Math.cos(b.yaw);
      const tipX = WING_W * Math.cos(wing);
      const tipY = WING_W * Math.sin(wing);
      for (let side = 1; side >= -1; side -= 2) {
        // Corners hinge-tail, hinge-head, tip-head, tip-tail in local space (forward +Z),
        // pitched nose-up, yawed and placed.
        for (let c = 0; c < 4; c++) {
          const x = c < 2 ? 0 : side * tipX;
          const y = c < 2 ? 0 : tipY;
          const z = c === 1 || c === 2 ? half : -half;
          const z1 = z * PITCH_C - y * PITCH_S;
          P[o] = fx + x * cy + z1 * sy;
          P[o + 1] = fy + y * PITCH_C + z * PITCH_S;
          P[o + 2] = fz - x * sy + z1 * cy;
          o += 3;
        }
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
