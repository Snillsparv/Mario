// Butterflies: pairs of flapping, alpha-tested wing quads (all in one dynamic mesh) that wander
// lazily around their spot and flutter away when the hero gets close.
//
// They keep out of solid scenery: at startup each spot's wander disk is fitted into open air
// (shifted away from buildings if needed), every tick walls push them out and deflect a flight
// along the wall, and one that rises close under a roof flies back home.

import * as THREE from 'three';
import { makeWingAtlas, wingUV, WING_VARIANTS } from './textures.js';
import { TAU, approachAngle, clamp } from '../core/math.js';
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
const SKY = 1e5; // probe height for "anything built above this column?"
const PITCH_S = Math.sin(0.25); // nose up
const PITCH_C = Math.cos(0.25);

export class Butterflies {
  // groundAt(x, z): analytic terrain height; collision: CollisionWorld (findFloor, findWalls,
  // waterLevelAt).
  constructor(spots, { collision, groundAt, rng }) {
    this.collision = collision;
    this.groundAt = groundAt;
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
        this._wanderTarget(b, 0, home.floor, b.pos);
        Object.assign(b.prev, b.pos);
        b.prevFlap = b.flap;
        this.list.push(b);
      }
    }
    this.mesh = this._buildMesh();
  }

  // Floor or water surface height below (x, y, z).
  _floorBelow(x, y, z) {
    return Math.max(this.collision.findFloor(x, y, z).y, this.collision.waterLevelAt(x, z));
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

  // Smooth Lissajous wander point around home at time t (seconds), written into out.
  _wanderTarget(b, t, base, out) {
    const { home, freq: f, phase: p } = b;
    const r = home.radius;
    out.x = home.x + r * (0.72 * Math.sin(t * f[0] + p[0]) + 0.28 * Math.sin(t * f[2] + p[2]));
    out.z = home.z + r * (0.72 * Math.cos(t * f[1] + p[1]) + 0.28 * Math.sin(t * f[3] + p[3]));
    out.y = base + ALT_MIN + (ALT_MAX - ALT_MIN) * (0.5 + 0.5 * Math.sin(t * f[4] + p[4]));
  }

  // Refreshes the floor under a butterfly. Walls push it out sideways, but nothing stops it
  // rising into a low roof or deck from below, so one with a floor just overhead heads home
  // (only possible outside its home's open-air radius).
  _probe(b, fromHome) {
    const { pos } = b;
    b.floor = this._floorBelow(pos.x, pos.y, pos.z);
    if (fromHome > b.home.clear && this.collision.findFloor(pos.x, pos.y + HEADROOM, pos.z, 0).y > pos.y) {
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
    const len = Math.hypot(d.x, d.z);
    if (len < 0.35) {
      d.x = -w.z * b.side;
      d.z = w.x * b.side;
    } else {
      d.x /= len;
      d.z /= len;
    }
  }

  update(tick, hero) {
    const t = tick * FRAME_DT;
    const target = this._target;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      const { pos, vel, prev, home } = b;
      prev.x = pos.x;
      prev.y = pos.y;
      prev.z = pos.z;
      b.prevFlap = b.flap;
      const fromHome = Math.hypot(pos.x - home.x, pos.z - home.z);
      if ((tick + i) % PROBE_EVERY === 0) this._probe(b, fromHome);

      const hx = pos.x - hero.x;
      const hz = pos.z - hero.z;
      const hd = Math.hypot(hx, hz);
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
      const base = Math.max(b.floor, home.floor);
      let maxSpeed = CRUISE_SPEED;
      if (b.homing > 0) {
        b.homing--;
        target.x = home.x;
        target.y = base + (ALT_MIN + ALT_MAX) / 2;
        target.z = home.z;
      } else if (b.flee > 0) {
        b.flee--;
        target.x = pos.x + b.fleeDir.x * 500;
        target.y = Math.min(pos.y + 250, base + 700);
        target.z = pos.z + b.fleeDir.z * 500;
        maxSpeed = FLEE_SPEED;
      } else {
        this._wanderTarget(b, t, base, target);
      }

      // Steer toward the target with limited acceleration.
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dz = target.z - pos.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const speed = Math.min(maxSpeed, d * 0.06 + 0.5);
      const ax = (dx / d) * speed - vel.x;
      const ay = (dy / d) * speed - vel.y;
      const az = (dz / d) * speed - vel.z;
      const a = Math.hypot(ax, ay, az);
      const k = a > ACCEL ? ACCEL / a : 1;
      vel.x += ax * k;
      vel.y += ay * k;
      vel.z += az * k;
      pos.x += vel.x;
      pos.y = clamp(pos.y + vel.y, b.floor + 60, base + ALT_CEIL);
      pos.z += vel.z;
      if (Math.hypot(pos.x - home.x, pos.z - home.z) > home.clear) this._pushOutOfWalls(b);

      if (Math.hypot(vel.x, vel.z) > 0.3) b.yaw = approachAngle(b.yaw, Math.atan2(vel.x, vel.z), 0.25);
      b.flap += (b.flee > 0 ? 13 : 8) * TAU * FRAME_DT;
    }
  }

  animate(alpha) {
    const P = this.positions;
    let o = 0;
    const half = WING_L / 2;
    for (const b of this.list) {
      const flap = b.prevFlap + (b.flap - b.prevFlap) * alpha;
      const s = Math.sin(flap);
      const wing = 0.15 + 1.15 * (0.5 + 0.5 * s); // hinge angle above horizontal
      F.x = b.prev.x + (b.pos.x - b.prev.x) * alpha;
      F.y = b.prev.y + (b.pos.y - b.prev.y) * alpha - 5 * s; // body dips as the wings rise
      F.z = b.prev.z + (b.pos.z - b.prev.z) * alpha;
      F.sy = Math.sin(b.yaw);
      F.cy = Math.cos(b.yaw);
      const tipX = WING_W * Math.cos(wing);
      const tipY = WING_W * Math.sin(wing);
      for (let side = 1; side >= -1; side -= 2) {
        o = corner(P, o, 0, 0, -half); // hinge-tail
        o = corner(P, o, 0, 0, half); // hinge-head
        o = corner(P, o, side * tipX, tipY, half); // tip-head
        o = corner(P, o, side * tipX, tipY, -half); // tip-tail
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

// Frame of the butterfly being written by animate(): centre and yaw.
const F = { x: 0, y: 0, z: 0, sy: 0, cy: 1 };

// Writes local point (x, y, z) (forward +Z) pitched, yawed and placed; returns the next offset.
function corner(P, o, x, y, z) {
  const z1 = z * PITCH_C - y * PITCH_S;
  P[o] = F.x + x * F.cy + z1 * F.sy;
  P[o + 1] = F.y + y * PITCH_C + z * PITCH_S;
  P[o + 2] = F.z - x * F.sy + z1 * F.cy;
  return o + 3;
}
