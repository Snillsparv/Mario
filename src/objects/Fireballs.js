// The robot beast's fireballs and what they leave behind (AI RACE mode).
//
//   new Fireballs({ collision, events, fx, level, layout, fire, rng })
//   launch(x, y, z, vx, vy, vz) -> ball | null   (units, units/tick; pool of CAPACITY)
//   update(player, tick)          30 Hz: flight, impacts, fire zones, burning trees, damage
//   animate(alpha, clock)         render: cores, halos and flame trails, ground glow markers
//   clear()                       nothing in flight, no fire zones, no burning trees
//
// Flight: `v.y -= GRAVITY; p += v` per tick (see RobotBeast.aimVelocity). Each step is
// raycast against the collision world and checked against the water surface; the first one hit
// ends the flight:
//   * water  -> a steam puff and a hiss (sfx 'splash' big + 'fireball_fizzle'), no fire
//   * ground / roof -> fx.explode (radius BLAST_FX), sfx 'fireball_explode', a scorch mark
//     (level.addScorch, on the terrain only), a FIRE ZONE (fx.ignite, damaging for its
//     duration) and nearby trees catch fire (fx.ignite on their canopies, each at most once
//     at a time)
//   * walls  -> the blast only
//   * a tree canopy on the way -> bursts in it and sets that tree (and neighbours) alight
//   * the hero's body -> bursts on him (2 wedges)
// Blast: the hero within BLAST_RADIUS takes 2 wedges (player.takeDamage(2, impactPos)).
// Fire zones: feet inside one -> player.takeDamage(1, zoneCentre, { fire: true }).
// The ground under each ball glows (one instanced draw call), brighter as it falls, so the
// landing spot is telegraphed.

import * as THREE from 'three';
import { FRAME_DT, NO_WATER } from '../core/constants.js';
import { FIRE } from './aiRaceTextures.js';
import { RAMP } from './FireSprites.js';
import { makeShadowTexture } from './textures.js';
import { SHOT } from './RobotBeast.js';

export const FIREBALL = {
  CAPACITY: 6,
  RADIUS: 70, // core radius (also the hit sphere against the hero)
  MAX_TICKS: 300, // gives up after 10 s
  BLAST_RADIUS: 260, // hero damage radius of an impact
  BLAST_FX: 250, // fx.explode radius
  BLAST_DAMAGE: 2,
  HIT_DAMAGE: 2,
  SCORCH: 180,
  ZONE_RADIUS: 160,
  ZONE_SECONDS: 8,
  ZONE_HEIGHT: 110, // feet up to this far above a zone's centre get burnt (jumping clears it)
  ZONE_DAMAGE: 1,
  MAX_ZONES: 12,
  TREE_RANGE: 350, // canopies within this horizontal distance of an impact catch fire
  TREE_SECONDS: 15,
  MARKER_MAX: 520, // ground glow diameter just before impact
  HERO_RADIUS: 50,
  HERO_LOW: 50, // hero capsule axis from feet + LOW to feet + HIGH
  HERO_HIGH: 110,
  SCORCH_SLACK: 90, // an impact this close to the terrain height counts as on the ground
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _dir = { x: 0, y: 0, z: 0 };
const _from = { x: 0, y: 0, z: 0 };

function ball(i) {
  return { i, alive: false, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, age: 0, spin: 0, markY: 0, markNx: 0, markNy: 1, markNz: 0, markOn: false, markH: 0 };
}

function zone() {
  return { alive: false, x: 0, y: 0, z: 0, until: 0, id: 0 };
}

// Core: a lumpy low-poly ball with hot vertex colours (white-yellow core facing out, orange
// and red patches), drawn unlit and unfogged so it blazes through the storm.
function coreGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = 0.5 + 0.5 * Math.sin(x * 5.1 + y * 3.7) * Math.cos(z * 4.3 - y * 2.2);
    const k = 0.9 + 0.2 * n;
    p.setXYZ(i, x * k, y * k, z * k);
    col[i * 3] = 1;
    col[i * 3 + 1] = 0.55 + 0.4 * n;
    col[i * 3 + 2] = 0.1 + 0.35 * n * n;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g;
}

export class Fireballs {
  constructor({ collision, events, fx, level, layout, fire, rng }) {
    this.collision = collision;
    this.events = events;
    this.fx = fx ?? null;
    this.level = level ?? null;
    this.fire = fire;
    this.rng = rng;
    this.groundHeight = layout?.groundHeight ?? null;
    this.trees = level?.trees ?? [];
    this.treeBurnUntil = new Float64Array(this.trees.length);
    this.treeIds = new Array(this.trees.length).fill(0); // fx fire ids of burning trees
    this.balls = Array.from({ length: FIREBALL.CAPACITY }, (_, i) => ball(i));
    this.zones = Array.from({ length: FIREBALL.MAX_ZONES }, zone);
    this.time = 0; // simulation seconds (ticks * FRAME_DT)
    this.inFlight = 0;
    this.impacts = 0; // counters (tests, debugging)

    this.mesh = new THREE.Group();
    this.mesh.name = 'fireballs';
    const core = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    this.cores = new THREE.InstancedMesh(coreGeometry(), core, FIREBALL.CAPACITY);
    this.cores.name = 'fireballCores';
    this.cores.frustumCulled = false;
    this.cores.count = 0;
    this.cores.visible = false;
    const glow = new THREE.MeshBasicMaterial({
      map: makeShadowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.markers = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), glow, FIREBALL.CAPACITY);
    this.markers.name = 'fireballMarkers';
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 0.6; // with the blob shadows: after the path decal, before water
    this.markers.visible = false;
    for (let i = 0; i < FIREBALL.CAPACITY; i++) {
      this.cores.setMatrixAt(i, ZERO);
      this.markers.setMatrixAt(i, ZERO);
      this.markers.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    this.mesh.add(this.cores, this.markers);
  }

  get zoneCount() {
    let n = 0;
    for (let i = 0; i < this.zones.length; i++) if (this.zones[i].alive) n++;
    return n;
  }

  // Starts a ball; null when all CAPACITY balls are in flight.
  launch(x, y, z, vx, vy, vz) {
    let b = null;
    for (let i = 0; i < this.balls.length; i++) {
      if (!this.balls[i].alive) {
        b = this.balls[i];
        break;
      }
    }
    if (!b) return null;
    b.alive = true;
    b.x = b.px = x;
    b.y = b.py = y;
    b.z = b.pz = z;
    b.vx = vx;
    b.vy = vy;
    b.vz = vz;
    b.age = 0;
    b.spin = this.rng() * 6.28;
    b.markOn = false;
    this.inFlight++;
    return b;
  }

  clear() {
    for (let i = 0; i < this.balls.length; i++) this.balls[i].alive = false;
    this.inFlight = 0;
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if (z.alive) this.fx?.extinguish?.(z.id);
      z.alive = false;
    }
    for (let i = 0; i < this.treeBurnUntil.length; i++) {
      if (this.treeBurnUntil[i] > this.time) this.fx?.extinguish?.(this.treeIds[i]);
      this.treeBurnUntil[i] = 0;
    }
    this.fire?.clear();
    this.cores.count = 0;
    this.cores.visible = false;
    this.markers.visible = false;
  }

  update(player, tick) {
    this.time = tick * FRAME_DT;
    const g = SHOT.GRAVITY;
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (!b.alive) continue;
      b.px = b.x;
      b.py = b.y;
      b.pz = b.z;
      b.vy -= g;
      b.x += b.vx;
      b.y += b.vy;
      b.z += b.vz;
      b.age++;
      if (this._hitsHero(b, player)) {
        this._burst(b, b.x, b.y, b.z, player, 'hero', null);
        continue;
      }
      if (this._stepHits(b, player)) continue;
      if (b.age >= FIREBALL.MAX_TICKS || b.y < -12000) {
        this._kill(b);
        continue;
      }
      this._trail(b, tick);
      this._marker(b);
    }
    this._updateZones(player);
  }

  _kill(b) {
    b.alive = false;
    this.inFlight--;
  }

  // Sphere (the ball, swept over this step in 4 samples) against the hero's body capsule.
  _hitsHero(b, player) {
    const a = player.action;
    if (!player.pos || a === 'death' || a === 'spawn') return false;
    const F = FIREBALL;
    const px = player.pos.x;
    const pz = player.pos.z;
    const lo = player.pos.y + F.HERO_LOW;
    const hi = player.pos.y + F.HERO_HIGH;
    const r = F.RADIUS + F.HERO_RADIUS;
    for (let k = 1; k <= 4; k++) {
      const u = k / 4;
      const x = b.px + (b.x - b.px) * u;
      const y = b.py + (b.y - b.py) * u;
      const z = b.pz + (b.z - b.pz) * u;
      const cy = y < lo ? lo : y > hi ? hi : y;
      const dx = x - px;
      const dy = y - cy;
      const dz = z - pz;
      if (dx * dx + dy * dy + dz * dz < r * r) {
        b.x = x;
        b.y = y;
        b.z = z;
        return true;
      }
    }
    return false;
  }

  // Raycasts this step; handles water, surfaces and tree canopies. True when the ball ended.
  _stepHits(b, player) {
    const dx = b.x - b.px;
    const dy = b.y - b.py;
    const dz = b.z - b.pz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return false;
    _from.x = b.px;
    _from.y = b.py;
    _from.z = b.pz;
    _dir.x = dx;
    _dir.y = dy;
    _dir.z = dz;
    const hit = this.collision.raycast ? this.collision.raycast(_from, _dir, len) : null;
    let tHit = hit ? hit.distance / len : 2;
    // Water surface crossed on this step (before any surface hit)?
    const col = this.collision;
    const w = col.waterLevelAt ? col.waterLevelAt(b.x, b.z) : NO_WATER;
    if (w !== NO_WATER && b.y < w && b.py >= w) {
      const tw = (b.py - w) / (b.py - b.y);
      if (tw <= tHit) {
        this._steam(b, b.px + dx * tw, w, b.pz + dz * tw);
        return true;
      }
    }
    // A canopy on the way (fireballs pass through leaves otherwise).
    const trees = this.trees;
    for (let i = 0; i < trees.length; i++) {
      const c = trees[i].canopy;
      if (!c) continue;
      const r = c.radius * 0.7;
      // Closest approach of the step segment to the canopy centre.
      const ox = c.x - b.px;
      const oy = c.y - b.py;
      const oz = c.z - b.pz;
      let u = (ox * dx + oy * dy + oz * dz) / (len * len);
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      if (u >= tHit) continue;
      const qx = ox - dx * u;
      const qy = oy - dy * u;
      const qz = oz - dz * u;
      if (qx * qx + qy * qy + qz * qz < r * r) {
        tHit = u;
        this._burst(b, b.px + dx * u, b.py + dy * u, b.pz + dz * u, player, 'tree', null);
        return true;
      }
    }
    if (hit) {
      const p = hit.point;
      this._burst(b, p.x, p.y, p.z, player, hit.normal.y > 0.5 ? 'ground' : 'wall', hit);
      return true;
    }
    return false;
  }

  // An explosion at (x, y, z): fx, sound, blast damage; ground impacts also scorch, leave a fire
  // zone and set trees alight.
  _burst(b, x, y, z, player, kind, hit) {
    this._kill(b);
    this.impacts++;
    const F = FIREBALL;
    const pos = { x, y, z };
    this.fx?.explode?.(x, y, z, { radius: F.BLAST_FX });
    this.events.emit('sfx', { name: 'fireball_explode', pos });
    this._flare(x, y, z);
    if (kind === 'hero') {
      player.takeDamage?.(F.HIT_DAMAGE, pos);
    } else if (this._inBlast(player, x, y, z)) {
      player.takeDamage?.(F.BLAST_DAMAGE, pos);
    }
    if (kind === 'ground') {
      const gh = this.groundHeight ? this.groundHeight(x, z) : y;
      if (y - gh < F.SCORCH_SLACK && gh - y < F.SCORCH_SLACK) this.level?.addScorch?.(x, z, F.SCORCH);
      this._addZone(x, y, z);
    }
    if (kind !== 'hero') this._igniteTrees(x, z);
  }

  // Hero body (capsule axis from feet + LOW to feet + HIGH) within BLAST_RADIUS of a point.
  _inBlast(player, x, y, z) {
    if (!player.pos) return false;
    const F = FIREBALL;
    const lo = player.pos.y + F.HERO_LOW;
    const hi = player.pos.y + F.HERO_HIGH;
    const cy = y < lo ? lo : y > hi ? hi : y;
    const dx = x - player.pos.x;
    const dy = y - cy;
    const dz = z - player.pos.z;
    return dx * dx + dy * dy + dz * dz < F.BLAST_RADIUS * F.BLAST_RADIUS;
  }

  _addZone(x, y, z) {
    const F = FIREBALL;
    let slot = null;
    let oldest = null;
    for (let i = 0; i < this.zones.length; i++) {
      const zn = this.zones[i];
      if (!zn.alive) {
        slot = zn;
        break;
      }
      if (!oldest || zn.until < oldest.until) oldest = zn;
    }
    if (!slot) {
      this.fx?.extinguish?.(oldest.id);
      slot = oldest;
    }
    slot.alive = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.until = this.time + F.ZONE_SECONDS;
    slot.id = this.fx?.ignite?.(x, y, z, { radius: F.ZONE_RADIUS, duration: F.ZONE_SECONDS, intensity: 1 }) ?? 0;
  }

  _igniteTrees(x, z) {
    const trees = this.trees;
    const F = FIREBALL;
    for (let i = 0; i < trees.length; i++) {
      const c = trees[i].canopy;
      if (!c || this.treeBurnUntil[i] > this.time) continue;
      const dx = c.x - x;
      const dz = c.z - z;
      if (dx * dx + dz * dz > F.TREE_RANGE * F.TREE_RANGE) continue;
      this.treeBurnUntil[i] = this.time + F.TREE_SECONDS;
      const id = this.fx?.ignite?.(c.x, c.y, c.z, { radius: c.radius * 0.8, duration: F.TREE_SECONDS, intensity: 1 }) ?? 0;
      this.treeIds[i] = id;
      this.events.emit('sfx', { name: 'tree_ignite', pos: { x: c.x, y: c.y, z: c.z } });
    }
  }

  // Burning tree i? (tests, other systems)
  treeBurning(i) {
    return this.treeBurnUntil[i] > this.time;
  }

  _updateZones(player) {
    const F = FIREBALL;
    const pos = player.pos;
    let burnt = false;
    for (let i = 0; i < this.zones.length; i++) {
      const zn = this.zones[i];
      if (!zn.alive) continue;
      if (this.time >= zn.until) {
        zn.alive = false;
        continue;
      }
      if (burnt || !pos) continue;
      const dx = pos.x - zn.x;
      const dz = pos.z - zn.z;
      const dy = pos.y - zn.y;
      if (dx * dx + dz * dz < F.ZONE_RADIUS * F.ZONE_RADIUS && dy > -60 && dy < F.ZONE_HEIGHT) {
        burnt = true; // one zone's damage per tick at most
        if (player.action !== 'death' && player.action !== 'spawn') player.takeDamage?.(F.ZONE_DAMAGE, { x: zn.x, y: zn.y, z: zn.z }, { fire: true });
      }
    }
  }

  _steam(b, x, y, z) {
    this._kill(b);
    this.impacts++;
    const pos = { x, y, z };
    this.events.emit('sfx', { name: 'splash', pos, big: true });
    this.events.emit('sfx', { name: 'fireball_fizzle', pos });
    const fire = this.fire;
    if (!fire) return;
    const rng = this.rng;
    for (let k = 0; k < 14; k++) {
      const p = fire.spawn(this.time, 1.1 + rng() * 0.8, FIRE.PUFF);
      if (!p) return;
      const a = rng() * 6.283;
      const r = rng() * 120;
      p.x = x + Math.cos(a) * r;
      p.y = y + 20;
      p.z = z + Math.sin(a) * r;
      p.vx = Math.cos(a) * (60 + rng() * 80);
      p.vy = 180 + rng() * 220;
      p.vz = Math.sin(a) * (60 + rng() * 80);
      p.gy = -60;
      p.size0 = 140 + rng() * 80;
      p.size1 = 420 + rng() * 160;
      p.a0 = 0.85;
      p.ramp = RAMP.steam;
    }
  }

  // A quick bright flash and a shower of embers where a ball bursts (the fx system draws the
  // explosion itself; this keeps the moment readable even without it).
  _flare(x, y, z) {
    const fire = this.fire;
    if (!fire) return;
    const rng = this.rng;
    const f = fire.spawn(this.time, 0.35, FIRE.GLOW);
    if (!f) return;
    f.x = x;
    f.y = y + 60;
    f.z = z;
    f.size0 = 700;
    f.size1 = 300;
    f.ramp = RAMP.flame;
    for (let k = 0; k < 16; k++) {
      const p = fire.spawn(this.time, 0.5 + rng() * 0.6, FIRE.SPARK);
      if (!p) return;
      const a = rng() * 6.283;
      const s = 250 + rng() * 450;
      p.x = x;
      p.y = y + 40;
      p.z = z;
      p.vx = Math.cos(a) * s;
      p.vy = 350 + rng() * 550;
      p.vz = Math.sin(a) * s;
      p.gy = -1400;
      p.size0 = 50;
      p.size1 = 12;
      p.ramp = RAMP.spark;
    }
  }

  // Flame puffs left along this tick's path (spawned at sub-tick times so the trail is even).
  _trail(b, tick) {
    const fire = this.fire;
    if (!fire) return;
    const rng = this.rng;
    const t0 = (tick - 1) * FRAME_DT;
    for (let k = 0; k < 3; k++) {
      const u = (k + 1) / 3;
      const p = fire.spawn(t0 + u * FRAME_DT, 0.3 + rng() * 0.25, k === 2 && rng() < 0.4 ? FIRE.PUFF : FIRE.FLAME);
      if (!p) return;
      p.x = b.px + (b.x - b.px) * u + (rng() - 0.5) * 50;
      p.y = b.py + (b.y - b.py) * u + (rng() - 0.5) * 50;
      p.z = b.pz + (b.z - b.pz) * u + (rng() - 0.5) * 50;
      p.vx = (rng() - 0.5) * 90;
      p.vy = 40 + rng() * 60;
      p.vz = (rng() - 0.5) * 90;
      p.size0 = 170 + rng() * 60;
      p.size1 = 40;
      p.ramp = p.cell === FIRE.PUFF ? RAMP.smoke : RAMP.flame;
      p.a0 = p.cell === FIRE.PUFF ? 0.8 : 1;
    }
  }

  // The floor (or water surface) under a ball, for its glowing landing marker.
  _marker(b) {
    const col = this.collision;
    const f = col.findFloor(b.x, b.y, b.z);
    const w = col.waterLevelAt ? col.waterLevelAt(b.x, b.z) : NO_WATER;
    if (!f.surface && w === NO_WATER) {
      b.markOn = false;
      return;
    }
    b.markOn = true;
    if (w !== NO_WATER && w > f.y) {
      b.markY = w;
      b.markNx = 0;
      b.markNy = 1;
      b.markNz = 0;
    } else {
      const n = f.surface.normal;
      b.markY = f.y;
      b.markNx = n.x;
      b.markNy = n.y;
      b.markNz = n.z;
    }
    b.markH = b.y - b.markY;
  }

  animate(alpha, clock) {
    let n = 0;
    let marks = 0;
    const F = FIREBALL;
    const fire = this.fire;
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (!b.alive) continue;
      const x = b.px + (b.x - b.px) * alpha;
      const y = b.py + (b.y - b.py) * alpha;
      const z = b.pz + (b.z - b.pz) * alpha;
      const wob = 1 + 0.08 * Math.sin(clock * 31 + b.spin);
      _q.setFromEuler(_e.set(clock * 5 + b.spin, clock * 7, 0));
      _m.compose(_p.set(x, y, z), _q, _s.set(F.RADIUS * wob, F.RADIUS / wob, F.RADIUS * wob));
      this.cores.setMatrixAt(n++, _m);
      if (fire) {
        const g = fire.glowSlot();
        if (g) {
          g.x = x;
          g.y = y;
          g.z = z;
          g.size = 420 + 60 * Math.sin(clock * 23 + b.spin);
          g.r = 1;
          g.g = 0.55;
          g.b = 0.15;
          g.a = 0.9;
        }
      }
      if (b.markOn) {
        // Grows and brightens as the ball comes down.
        const h = b.markH > 0 ? b.markH : 0;
        const k = h > 3000 ? 0 : 1 - h / 3000;
        const size = 140 + (F.MARKER_MAX - 140) * k;
        _n.set(b.markNx, b.markNy, b.markNz);
        _q.setFromUnitVectors(UP, _n);
        _m.compose(_p.set(x, b.markY + 3, z), _q, _s.set(size, 1, size));
        this.markers.setMatrixAt(marks, _m);
        this.markers.setColorAt(marks, _c.setRGB(0.35 + 0.65 * k, (0.12 + 0.35 * k) * (0.35 + 0.65 * k), 0.03));
        marks++;
      }
    }
    for (let i = n; i < this.cores.count; i++) this.cores.setMatrixAt(i, ZERO);
    this.cores.count = n;
    this.cores.visible = n > 0;
    this.cores.instanceMatrix.needsUpdate = true;
    for (let i = marks; i < F.CAPACITY; i++) this.markers.setMatrixAt(i, ZERO);
    this.markers.count = marks;
    this.markers.visible = marks > 0;
    this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
  }
}
