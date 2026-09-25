// Sporebots, the minions of AI RACE mode: small original walking machines with a mushroom-like
// build (minionModel.js: a riveted gunmetal dome cap, two red optic lenses under its rim, a
// ribbed stem and three piston legs) that burrow out of the ground around the hero once the
// Rustmaw has fully risen, scuttle after him and lunge to ram him with the cap.
//
//   new Minions({ collision, events, fx, fire, sparkles, shadows, shadowBase, rng, layout,
//                 groundAt, onCoin })
//   update(player, hero, tick, active, hold?)  30 Hz. active: the beast is up (ObjectManager);
//                                       hero = the previous tick's { y, vy, air } of the player;
//                                       hold: a dialog is up (Pip is frozen): no spawns or rams,
//                                       they keep their distance
//   animate(alpha, clock, camera)       render: instance matrices, gait attributes, shadows,
//                                       eye glows
//   clear()                             every minion gone at once (reset)
//   alive                               minions up and about (not burrowing, wrecked or free)
//
// Timing: FIRST_DELAY ticks (10 s) after `active` turns on, then one every EVERY (~5 s) while
// fewer than MAX_ALIVE are about. A spawn spot is 700..1600 from the hero, on the lawn or the
// island (regionAt), on the real ground (not a roof, rock or tree), dry, clear of walls, the
// castle door and the AI RACE button. It pushes up out of the earth cap first (clods, sfx
// minion_emerge).
//
// AI: it turns toward the hero (weaving a little) and scuttles over the terrain at 12..16 per
// tick on its tripod gait: the floor is followed with findFloor (steps up to STEP_UP; drops over
// STEP_DOWN, holes and water are refused: it turns away along the edge, so it paces the shore),
// walls push it out (findWalls), and the others are kept at arm's length. Within ATTACK_RANGE it
// winds up (crouches on its legs, tips its cap forward, eyes flaring, sparks crackling round the
// rim), then lunges in a short hop, cap first; if the cap's rim meets the hero he takes 1 wedge
// with knockback (player.takeDamage(1, minionPos), sfx minion_bite); not while he is invincible,
// reading or dropping in. A cooldown follows.
//
// Defeat: an attack of the hero's (player.getAttack() -> { x, y, z, radius }) touching its body
// (an upright capsule), or a stomp (the hero falling onto its cap: player.bounce()). It flips
// onto its cap in a blast of sparks and scrap (fx.explode radius 120, sfx minion_wreck), legs
// flailing, then vanishes; DROP_CHANCE of the time a yellow coin appears there (onCoin(x, y, z)).
// When `active` turns off every minion burrows back down.
//
// Rendering: one InstancedMesh (one draw call) for all of them; the two eye glows each go to the
// shared fire sprites, shadows to the shared blob shadows (slots shadowBase + i). Per tick the
// minions cost a few collision queries each (the small result objects are the only allocation);
// the render path allocates nothing.

import * as THREE from 'three';
import { FRAME_DT, PLAYER_HEIGHT, PLAYER_RADIUS } from '../core/constants.js';
import { TAU, wrapAngle, approachAngle } from '../core/math.js';
import { buildMinionGeometry, makeMinionMaterial, MINION_RIG, MINION_ANIM } from './minionModel.js';
import { FIRE } from './aiRaceTextures.js';
import { RAMP, TINTS } from './FireSprites.js';
import { TINT } from './Sparkles.js';
import { shadowSize } from './BlobShadows.js';

export const MINION = {
  POOL: 8, // records (wrecks still animating need slots too)
  MAX_ALIVE: 5,
  FIRST_DELAY: 300, // ticks after the beast has fully risen (10 s)
  EVERY: [135, 165], // ticks between spawns (~5 s)
  RETRY: 10, // no spot found: try again this soon
  SPAWN_MIN: 700,
  SPAWN_MAX: 1600,
  SPAWN_TRIES: 10,
  DOOR_CLEAR: 800, // no spawns this close to the castle door (the porch and courtyard)
  CANNON_CLEAR: 950, // ...nor this close to the cannon (layout.CANNON: its drum, pad and exit spot)
  GROUND_TOLERANCE: 60, // spawn floor within this of the analytic ground
  CLEARANCE: 90, // no wall this close to a spawn spot
  SPEED: [12, 16],
  TURN: 0.14,
  STOP: 130, // closest approach outside a lunge (centre to centre; the cap is ~63 across)
  HOLD_OFF: 450, // ... while the hero is reading, dying or dropping in
  STEP_UP: 70,
  STEP_DOWN: 160,
  WALL_Y: 30,
  WALL_RADIUS: 55, // the cap's overhang keeps clear of walls
  SEPARATION: 130,
  ATTACK_RANGE: 250,
  ATTACK_HEIGHT: 160,
  WINDUP: 10,
  LUNGE: 16, // at most (it ends when it lands)
  RECOVER: 14,
  COOLDOWN: 36,
  LUNGE_SPEED: 21,
  LUNGE_VY: 15,
  GRAVITY: 3,
  STRIKE_AT: 6, // lunge tick the ram lands (sfx minion_bite), on the hero or thin air
  RAM_RADIUS: 30, // round the cap's front rim
  BODY_RADIUS: 55, // body capsule (upright, on the axis), for the hero's attacks ...
  BODY_LOW: 30, // ... its axis from this height over the feet ...
  BODY_HIGH: MINION_RIG.BACK - 50, // ... to this one (the capsule's top near the cap's)
  STOMP_REACH: 36, // the feet axis within PLAYER_RADIUS + this of the cap's axis
  EMERGE: 27,
  BURROW: 24,
  DEPTH: 150, // how deep they lie before emerging (the whole machine under the turf)
  WRECK: 40,
  VANISH: 8,
  WRECK_VY: 15,
  WRECK_GRAVITY: 2.6,
  WRECK_KNOCK: 7,
  FLIP_TICKS: 12,
  DROP_CHANCE: 0.3,
  GAIT: 0.085, // gait radians per unit walked
  PIVOT: MINION_RIG.BACK / 2, // pitch and roll turn about this height (a flipped one lies on its cap)
  SHADOW: 150, // blob shadow size
};

const ACTIVE = { emerging: 1, walk: 1, windup: 1, lunge: 1, recover: 1 };
const HITTABLE = { walk: 1, windup: 1, lunge: 1, recover: 1 };

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const clamp1 = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// Cheap deterministic noise in 0..1 (effects that must not draw on the rng).
const noise = (n) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

// Is the hero blinking after a hit? (Player: tick < invincibleUntil; a plain boolean also works.)
export function heroInvincible(p) {
  if (typeof p.invincible === 'boolean') return p.invincible;
  return p.invincibleUntil !== undefined && p.tick !== undefined && p.tick < p.invincibleUntil;
}

// Not a target right now: reading a sign, dying or dropping in.
const heroAway = (a) => a === 'reading' || a === 'death' || a === 'spawn';
// Actions that never stomp: knocked back or burnt (landing on one after a hit is no stomp),
// dying, dropping in.
const NO_STOMP = { hurt: 1, burn: 1, death: 1, spawn: 1, spawn_land: 1, reading: 1 };

function record(i) {
  return {
    i,
    state: 'free',
    t: 0,
    x: 0,
    y: 0,
    z: 0,
    px: 0,
    py: 0,
    pz: 0,
    yaw: 0,
    pyaw: 0,
    pitch: 0,
    ppitch: 0,
    roll: 0,
    proll: 0,
    sink: 0,
    psink: 0,
    scale: 1,
    pscale: 1,
    phase: 0,
    pphase: 0,
    stride: 0,
    pstride: 0,
    tilt: 0, // cap tilt (1: tipped fully forward, below 0: back)
    ptilt: 0,
    crouch: 0, // legs bent (1), straight (0), stretched (below 0)
    pcrouch: 0,
    flare: 0,
    pflare: 0,
    power: 1,
    ppower: 1,
    vx: 0,
    vy: 0,
    vz: 0,
    speed: 14,
    cooldown: 0,
    rammed: false, // this lunge has already rammed the hero
    avoid: 0,
    turn: 1,
    blocked: 0,
    seed: 0,
    drop: false,
    floorY: 0,
    floorN: null,
    shadow: false,
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _o = new THREE.Vector3();
const UP = { x: 0, y: 1, z: 0 };

export class Minions {
  constructor({ collision, events, fx = null, fire = null, sparkles = null, shadows = null, shadowBase = -1, rng, layout = {}, groundAt = null, onCoin = null }) {
    this.collision = collision;
    this.events = events;
    this.fx = fx;
    this.fire = fire;
    this.sparkles = sparkles;
    this.shadows = shadows;
    this.shadowBase = shadowBase;
    this.rng = rng;
    this.regionAt = layout.regionAt ?? null;
    this.groundAt = groundAt;
    this.onCoin = onCoin;
    const c = layout.CASTLE;
    this.door = Number.isFinite(c?.frontZ) ? { x: c.x ?? 0, z: c.frontZ } : null;
    this.keepOut = layout.AI_BUTTON ? [{ x: layout.AI_BUTTON.x, z: layout.AI_BUTTON.z, r: (layout.AI_BUTTON.radius ?? 140) + 120 }] : [];
    // The cannon (Cannon.js): nothing bursts out of its emplacement, its loading pad or the spot
    // Pip climbs out onto.
    if (layout.CANNON) this.keepOut.push({ x: layout.CANNON.x, z: layout.CANNON.z, r: MINION.CANNON_CLEAR });
    this.list = Array.from({ length: MINION.POOL }, (_, i) => record(i));
    this._crushFrom = { pos: { x: 0, y: 0, z: 0 } }; // crush(): the knock-away centre
    this.tick = 0;
    this.activeTicks = 0; // ticks the beast has been up (0: not up)
    this.nextSpawn = MINION.FIRST_DELAY;
    this.spawned = 0;
    this.wrecks = 0;
    this.rams = 0; // rams that hurt the hero
    this.camera = null;
    this.hold = false;

    const geo = buildMinionGeometry();
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(MINION.POOL * 4), 4);
    const anim2 = new THREE.InstancedBufferAttribute(new Float32Array(MINION.POOL * 4), 4);
    anim.setUsage(THREE.DynamicDrawUsage);
    anim2.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', anim);
    geo.setAttribute('aAnim2', anim2);
    this.anim = anim;
    this.anim2 = anim2;
    this.material = makeMinionMaterial();
    this.mesh = new THREE.InstancedMesh(geo, this.material, MINION.POOL);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = 'minions';
    this.mesh.frustumCulled = false; // they swarm round the hero
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  // Minions up and about (emerging, chasing, attacking).
  get alive() {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) if (ACTIVE[this.list[i].state] === 1) n++;
    return n;
  }

  // Every minion gone at once, the spawn clock back to the start.
  clear() {
    for (let i = 0; i < this.list.length; i++) this._free(this.list[i]);
    this.activeTicks = 0;
    this.nextSpawn = MINION.FIRST_DELAY;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  _free(m) {
    m.state = 'free';
    m.t = 0;
    if (m.shadow && this.shadows) this.shadows.hide(this.shadowBase + m.i);
    m.shadow = false;
  }

  _rand(range) {
    return range[0] + Math.floor(this.rng() * (range[1] - range[0] + 1));
  }

  _sfx(name, m) {
    this.events.emit('sfx', { name, pos: { x: m.x, y: m.y + 60, z: m.z } });
  }

  update(player, hero, tick, active, hold = false) {
    this.tick = tick;
    this.hold = hold;
    if (active) {
      if (this.activeTicks === 0) this.nextSpawn = MINION.FIRST_DELAY;
      this.activeTicks++;
    } else if (this.activeTicks > 0) {
      this.activeTicks = 0;
      this._burrowAll();
    }
    if (active && this.activeTicks >= this.nextSpawn) {
      if (this.hold || heroAway(player.action)) this.nextSpawn = this.activeTicks + MINION.RETRY;
      else if (this.alive >= MINION.MAX_ALIVE) this.nextSpawn = this.activeTicks + this._rand(MINION.EVERY);
      else this.nextSpawn = this.activeTicks + (this._trySpawn(player) ? this._rand(MINION.EVERY) : MINION.RETRY);
    }
    const atk = player.getAttack ? player.getAttack() : null;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.state === 'free') continue;
      this._save(m);
      m.t++;
      if (HITTABLE[m.state] === 1 || (m.state === 'emerging' && m.t > MINION.EMERGE / 2)) {
        if (atk !== null && this._struck(m, atk)) {
          this._wreck(m, player, false);
          continue;
        }
        if (this._stomped(m, player, hero) && (!player.bounce || player.bounce() !== false)) {
          this._wreck(m, player, true);
          continue;
        }
      }
      const s = m.state;
      if (s === 'emerging') this._emerge(m);
      else if (s === 'walk') this._chase(m, player);
      else if (s === 'windup') this._windup(m, player);
      else if (s === 'lunge') this._lunge(m, player);
      else if (s === 'recover') this._recover(m);
      else if (s === 'burrow') this._burrow(m);
      else if (s === 'wrecked') this._wrecked(m);
      else if (s === 'vanish') this._vanish(m);
    }
  }

  _save(m) {
    m.px = m.x;
    m.py = m.y;
    m.pz = m.z;
    m.pyaw = m.yaw;
    m.ppitch = m.pitch;
    m.proll = m.roll;
    m.psink = m.sink;
    m.pscale = m.scale;
    m.pphase = m.phase;
    m.pstride = m.stride;
    m.ptilt = m.tilt;
    m.pcrouch = m.crouch;
    m.pflare = m.flare;
    m.ppower = m.power;
  }

  // ------------------------------------------------------------------ spawning

  // Floor height at (x, z) if a minion may burst out there, else null.
  spawnFloor(x, z) {
    const M = MINION;
    if (this.regionAt) {
      const r = this.regionAt(x, z);
      if (r !== 'lawn' && r !== 'island') return null;
    }
    const d = this.door;
    if (d && (x - d.x) * (x - d.x) + (z - d.z) * (z - d.z) < M.DOOR_CLEAR * M.DOOR_CLEAR) return null;
    for (let i = 0; i < this.keepOut.length; i++) {
      const k = this.keepOut[i];
      if ((x - k.x) * (x - k.x) + (z - k.z) * (z - k.z) < k.r * k.r) return null;
    }
    const col = this.collision;
    const f = col.findFloor(x, 1e5, z);
    if (!f.surface || f.surface.surface === 'death') return null;
    if (this.groundAt) {
      const g = this.groundAt(x, z);
      if (f.y - g > M.GROUND_TOLERANCE || g - f.y > M.GROUND_TOLERANCE) return null;
    }
    if (col.waterLevelAt && col.waterLevelAt(x, z) > f.y - 10) return null;
    if (col.findWalls(x, f.y, z, 40, M.CLEARANCE).walls.length > 0) return null;
    return f;
  }

  _trySpawn(player) {
    let m = null;
    for (let i = 0; i < this.list.length && !m; i++) if (this.list[i].state === 'free') m = this.list[i];
    if (!m) return false;
    const M = MINION;
    const p = player.pos;
    for (let k = 0; k < M.SPAWN_TRIES; k++) {
      const a = this.rng() * TAU;
      const r = M.SPAWN_MIN + this.rng() * (M.SPAWN_MAX - M.SPAWN_MIN);
      const x = p.x + Math.sin(a) * r;
      const z = p.z + Math.cos(a) * r;
      const f = this.spawnFloor(x, z);
      if (!f) continue;
      this._emergeAt(m, x, f.y, z, f.surface.normal, Math.atan2(p.x - x, p.z - z));
      return true;
    }
    return false;
  }

  // Starts minion record m bursting out of the ground at (x, y, z) facing `yaw`.
  _emergeAt(m, x, y, z, normal, yaw) {
    const M = MINION;
    m.state = 'emerging';
    m.t = 0;
    m.x = x;
    m.y = y;
    m.z = z;
    m.floorY = y;
    m.floorN = normal;
    m.yaw = yaw;
    m.pitch = -0.5;
    m.roll = 0;
    m.sink = -M.DEPTH;
    m.scale = 1;
    m.phase = 0;
    m.stride = 0.6;
    m.tilt = -0.4;
    m.crouch = 0;
    m.flare = 0.6;
    m.power = 1;
    m.vx = m.vy = m.vz = 0;
    m.speed = M.SPEED[0] + this.rng() * (M.SPEED[1] - M.SPEED[0]);
    m.cooldown = 20;
    m.rammed = false;
    m.avoid = 0;
    m.turn = this.rng() < 0.5 ? 1 : -1;
    m.blocked = 0;
    m.seed = this.rng();
    m.drop = false;
    this._save(m);
    this.spawned++;
    this._sfx('minion_emerge', m);
    this.sparkles?.clods({ x, y, z }, this.tick * FRAME_DT, TINT.dirt, 14, 1.1);
  }

  // Emerges a minion at (x, z) at once (previews and tests); returns it, or null.
  spawnAt(x, z, faceYaw = 0) {
    const m = this.list.find((r) => r.state === 'free');
    const f = this.collision.findFloor(x, 1e5, z);
    if (!m || !f.surface) return null;
    this._emergeAt(m, x, f.y, z, f.surface.normal, faceYaw);
    return m;
  }

  _burrowAll() {
    for (let i = 0; i < this.list.length; i++) {
      const m = this.list[i];
      if (ACTIVE[m.state] !== 1) continue;
      m.state = 'burrow';
      m.t = 0;
      m.y = m.floorY;
      m.vy = 0;
      m.tilt = 0;
      m.crouch = 0;
    }
  }

  // ------------------------------------------------------------------ states

  _emerge(m) {
    const M = MINION;
    const u = m.t / M.EMERGE;
    const e = 1 - (1 - u) * (1 - u);
    m.sink = -M.DEPTH * (1 - e);
    m.pitch = -0.5 * (1 - smooth(u));
    m.tilt = -0.4 * (1 - smooth(u));
    m.phase += 0.55;
    m.stride = 0.8;
    m.flare = 0.6 * (1 - u);
    if (m.t % 5 === 0 && m.t < 20) this.sparkles?.clods({ x: m.x, y: m.y, z: m.z }, this.tick * FRAME_DT, TINT.dirt, 4, 0.7);
    if (m.t >= M.EMERGE) {
      m.state = 'walk';
      m.t = 0;
      m.sink = 0;
      m.pitch = 0;
      m.tilt = 0;
    }
  }

  _chase(m, player) {
    const M = MINION;
    const p = player.pos;
    const dx = p.x - m.x;
    const dz = p.z - m.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (m.cooldown > 0) m.cooldown--;
    const away = this.hold || heroAway(player.action);
    const dy = p.y - m.y;
    // The cap leans into the run and nods, scanning.
    m.tilt += (0.12 * m.stride + 0.1 * Math.sin(this.tick * 0.23 + m.seed * 9) - m.tilt) * 0.3;
    m.crouch *= 0.6;
    m.flare *= 0.8;
    if (!away && m.cooldown === 0 && d < M.ATTACK_RANGE && dy < M.ATTACK_HEIGHT && dy > -M.ATTACK_HEIGHT && !heroInvincible(player)) {
      m.state = 'windup';
      m.t = 0;
      return;
    }
    const weave = Math.sin(this.tick * 0.08 + m.seed * TAU) * (d > 500 ? 0.4 : 0.12);
    const want = Math.atan2(dx, dz) + weave + m.avoid;
    m.yaw = approachAngle(m.yaw, want, M.TURN);
    let moved = 0;
    if (d > (away ? M.HOLD_OFF : M.STOP)) moved = this._move(m, m.speed);
    else m.avoid *= 0.9;
    const target = moved / M.SPEED[1];
    m.stride += (target - m.stride) * 0.35;
    m.phase += moved * M.GAIT;
    m.pitch *= 0.7;
  }

  // One step of `dist` along the heading over the terrain; returns the distance moved (0 when
  // blocked by water, a drop, a hole or a high step: it then steers away along the edge).
  _move(m, dist) {
    const M = MINION;
    const col = this.collision;
    let nx = m.x + Math.sin(m.yaw) * dist;
    let nz = m.z + Math.cos(m.yaw) * dist;
    // Keep apart from the others.
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === m || ACTIVE[o.state] !== 1) continue;
      const ox = nx - o.x;
      const oz = nz - o.z;
      const d2 = ox * ox + oz * oz;
      if (d2 >= M.SEPARATION * M.SEPARATION || d2 < 1) continue;
      const d = Math.sqrt(d2);
      const push = ((M.SEPARATION - d) / d) * 0.5;
      nx += ox * push;
      nz += oz * push;
    }
    const w = col.findWalls(nx, m.y, nz, M.WALL_Y, M.WALL_RADIUS);
    nx = w.x;
    nz = w.z;
    // Held up by a wall (little progress along the heading): steer round it.
    const sx = Math.sin(m.yaw);
    const sz = Math.cos(m.yaw);
    const walled = w.walls.length > 0 && (nx - m.x) * sx + (nz - m.z) * sz < dist * 0.5;
    const f = col.findFloor(nx, m.y, nz, M.STEP_UP);
    const water = col.waterLevelAt ? col.waterLevelAt(nx, nz) : -Infinity;
    if (!f.surface || f.y < m.y - M.STEP_DOWN || f.surface.surface === 'death' || water > f.y - 10) {
      // Edge: turn away (the same way for a while, then the other way).
      m.blocked++;
      m.avoid = clamp1(m.avoid + m.turn * 0.3, -2.2, 2.2);
      if (m.blocked % 45 === 0) m.turn = -m.turn;
      return 0;
    }
    if (walled) {
      m.blocked++;
      m.avoid = clamp1(m.avoid + m.turn * 0.2, -2.2, 2.2);
      if (m.blocked % 60 === 0) m.turn = -m.turn;
    } else if (m.blocked > 0) m.blocked = 0;
    else m.avoid *= 0.96;
    const mx = nx - m.x;
    const mz = nz - m.z;
    m.x = nx;
    m.z = nz;
    m.y = f.y;
    m.floorY = f.y;
    m.floorN = f.surface.normal;
    return Math.sqrt(mx * mx + mz * mz);
  }

  _windup(m, player) {
    const M = MINION;
    const p = player.pos;
    const u = m.t / M.WINDUP;
    m.yaw = approachAngle(m.yaw, Math.atan2(p.x - m.x, p.z - m.z), 0.3);
    m.pitch = -0.08 * u;
    m.crouch = u;
    m.tilt = 0.85 * u;
    m.flare = u;
    m.stride *= 0.6;
    m.phase += 0.2;
    if ((m.t & 1) === 0) this._crackle(m);
    if (m.t >= M.WINDUP) {
      m.state = 'lunge';
      m.t = 0;
      m.sink = 0;
      m.crouch = -0.6; // the legs kick it off
      m.vx = Math.sin(m.yaw) * M.LUNGE_SPEED;
      m.vz = Math.cos(m.yaw) * M.LUNGE_SPEED;
      m.vy = M.LUNGE_VY;
      m.rammed = false;
    }
  }

  _lunge(m, player) {
    const M = MINION;
    const col = this.collision;
    // Horizontal: stop at walls, water and drops (it never leaps into the moat).
    if (m.vx !== 0 || m.vz !== 0) {
      const w = col.findWalls(m.x + m.vx, m.y, m.z + m.vz, M.WALL_Y, M.WALL_RADIUS);
      const f = col.findFloor(w.x, m.y + 20, w.z, M.STEP_UP);
      const water = col.waterLevelAt ? col.waterLevelAt(w.x, w.z) : -Infinity;
      if (!f.surface || f.y < m.floorY - M.STEP_DOWN || water > f.y - 10) {
        m.vx = 0;
        m.vz = 0;
      } else {
        m.x = w.x;
        m.z = w.z;
        m.floorY = f.y;
        m.floorN = f.surface.normal;
      }
    }
    m.vy -= M.GRAVITY;
    m.y += m.vy;
    m.pitch = -m.vy * 0.018;
    m.stride = 0.3;
    m.crouch *= 0.7;
    // The cap's rim rams the hero (or lands on thin air at STRIKE_AT): sfx minion_bite either way.
    let strike = false;
    if (!m.rammed && m.t <= M.STRIKE_AT + 1 && this._rams(m, player)) {
      m.rammed = true;
      strike = true;
      this._sfx('minion_bite', m);
      if (!this.hold && !heroAway(player.action) && !heroInvincible(player)) {
        this.rams++;
        player.takeDamage?.(1, { x: m.x, y: m.y, z: m.z });
      }
    } else if (m.t === M.STRIKE_AT && !m.rammed) {
      strike = true;
      this._sfx('minion_bite', m);
    }
    // Cap tipped forward and eyes blazing until the strike, a jolt on it, then easing back.
    const charging = m.t < M.STRIKE_AT && !m.rammed;
    m.tilt = strike ? 1.3 : charging ? 1 : 0.5 + (m.tilt - 0.5) * 0.75;
    m.flare = charging || strike ? 1 : 0.4;
    if ((m.y <= m.floorY && m.vy < 0) || m.t >= M.LUNGE) {
      m.y = m.floorY;
      m.vy = 0;
      m.state = 'recover';
      m.t = 0;
    }
  }

  // Does the cap's front rim reach the hero's body (a capsule from his feet up)?
  _rams(m, player) {
    const M = MINION;
    const p = player.pos;
    const reach = MINION_RIG.FRONT * 0.85;
    const hx = m.x + Math.sin(m.yaw) * reach;
    const hz = m.z + Math.cos(m.yaw) * reach;
    const hy = m.y + MINION_RIG.BODY_Y;
    const dx = p.x - hx;
    const dz = p.z - hz;
    const r = PLAYER_RADIUS + M.RAM_RADIUS;
    return dx * dx + dz * dz <= r * r && hy >= p.y - 20 && hy <= p.y + PLAYER_HEIGHT + 20;
  }

  // Sparks crackling off the rim during the wind-up (cheap noise, so the rng's sequence and the
  // spawn spots do not depend on how often they attack).
  _crackle(m) {
    const fire = this.fire;
    if (!fire) return;
    const t0 = this.tick * FRAME_DT;
    const r = MINION_RIG.RADIUS * 0.95;
    const y = m.y + MINION_RIG.RIM_Y - 6;
    for (let k = 0; k < 2; k++) {
      const n = m.seed * 131 + m.t * 7 + k * 3;
      const p = fire.spawn(t0, 0.14 + 0.12 * noise(n), FIRE.SPARK);
      if (!p) return;
      const a = m.yaw + (noise(n + 1) - 0.5) * 3.6; // round the front half of the rim
      const sx = Math.sin(a);
      const sz = Math.cos(a);
      p.x = m.x + sx * r;
      p.y = y;
      p.z = m.z + sz * r;
      p.vx = sx * (160 + 180 * noise(n + 2));
      p.vy = 90 + 220 * noise(n + 3);
      p.vz = sz * (160 + 180 * noise(n + 2));
      p.gy = -1100;
      p.size0 = 18 + 12 * noise(n + 4);
      p.size1 = 4;
      p.ramp = RAMP.spark;
    }
  }

  _recover(m) {
    const M = MINION;
    m.tilt *= 0.8;
    m.crouch *= 0.6;
    m.flare *= 0.8;
    m.pitch *= 0.6;
    m.stride *= 0.7;
    if (m.t >= M.RECOVER) {
      m.state = 'walk';
      m.t = 0;
      m.cooldown = M.COOLDOWN;
    }
  }

  _burrow(m) {
    const M = MINION;
    const u = m.t / M.BURROW;
    m.sink = -M.DEPTH * smooth(u);
    m.pitch = 0.6 * smooth(u / 0.4);
    m.phase += 0.6;
    m.stride = 0.8;
    if (m.t % 5 === 1 && m.t < 20) this.sparkles?.clods({ x: m.x, y: m.y, z: m.z }, this.tick * FRAME_DT, TINT.dirt, 4, 0.7);
    if (m.t >= M.BURROW) this._free(m);
  }

  // ------------------------------------------------------------------ defeat

  // Does an attack sphere touch the body (an upright capsule on the axis, BODY_LOW..BODY_HIGH
  // over the feet)?
  _struck(m, atk) {
    const M = MINION;
    const base = m.y + m.sink;
    let cy = atk.y;
    cy = cy < base + M.BODY_LOW ? base + M.BODY_LOW : cy > base + M.BODY_HIGH ? base + M.BODY_HIGH : cy;
    const dx = atk.x - m.x;
    const dy = atk.y - cy;
    const dz = atk.z - m.z;
    const r = atk.radius + M.BODY_RADIUS;
    return dx * dx + dy * dy + dz * dz <= r * r;
  }

  // Did the hero come down onto its cap this tick? (Falling, his feet above the cap's top on the
  // previous tick and at or below it now, his feet axis over the cap.)
  _stomped(m, player, hero) {
    const M = MINION;
    const p = player.pos;
    if (NO_STOMP[player.action] === 1) return false;
    const vy = player.vel ? player.vel.y : 0;
    if (!(vy < 0 || (hero && hero.vy < 0))) return false;
    if (hero && !hero.air) return false;
    const top = m.y + m.sink + MINION_RIG.BACK;
    const prevY = hero ? hero.y : p.y - vy;
    if (prevY < top - 20 || p.y > top + 25 || p.y < m.y - 40) return false;
    const dx = p.x - m.x;
    const dz = p.z - m.z;
    const r = PLAYER_RADIUS + M.STOMP_REACH;
    return dx * dx + dz * dz <= r * r;
  }

  // A server hall takes the ground under some minions (ServerHalls onClaim): every one standing
  // where `covers(x, z)` holds is wrecked, knocked away from (cx, cz), and drops no coin (it
  // would be buried). Returns how many.
  crush(covers, cx, cz) {
    let n = 0;
    const from = this._crushFrom;
    from.pos.x = cx;
    from.pos.z = cz;
    for (let i = 0; i < this.list.length; i++) {
      const m = this.list[i];
      if (m.state === 'free' || m.state === 'wrecked' || m.state === 'vanish') continue;
      if (!covers(m.x, m.z)) continue;
      this._wreck(m, from, false);
      m.drop = false;
      n++;
    }
    return n;
  }

  _wreck(m, player, stomped) {
    const M = MINION;
    m.state = 'wrecked';
    m.t = 0;
    m.y = m.y + m.sink > m.floorY ? m.y + m.sink : m.floorY;
    m.sink = 0;
    let ax = m.x - player.pos.x;
    let az = m.z - player.pos.z;
    const len = Math.sqrt(ax * ax + az * az);
    if (len > 1) {
      ax /= len;
      az /= len;
    } else {
      ax = -Math.sin(m.yaw);
      az = -Math.cos(m.yaw);
    }
    const knock = stomped ? 2 : M.WRECK_KNOCK;
    m.vx = ax * knock;
    m.vz = az * knock;
    m.vy = stomped ? 8 : M.WRECK_VY;
    m.power = 0;
    m.flare = 0;
    m.tilt = -0.6; // the cap knocked askew
    m.crouch = 0;
    m.drop = this.rng() < M.DROP_CHANCE;
    this.wrecks++;
    this.fx?.explode?.(m.x, m.y + MINION_RIG.BODY_Y * 0.6, m.z, { radius: 120 });
    this._sfx('minion_wreck', m);
    this.sparkles?.clods({ x: m.x, y: m.y + 50, z: m.z }, this.tick * FRAME_DT, TINT.scrap, 10, 1);
  }

  _wrecked(m) {
    const M = MINION;
    const col = this.collision;
    if (m.vx !== 0 || m.vz !== 0) {
      const w = col.findWalls(m.x + m.vx, m.y, m.z + m.vz, M.WALL_Y, M.WALL_RADIUS);
      const f = col.findFloor(w.x, m.y + 40, w.z, M.STEP_UP);
      if (f.surface && f.y > m.floorY - M.STEP_DOWN) {
        m.x = w.x;
        m.z = w.z;
        m.floorY = f.y;
        m.floorN = f.surface.normal;
      } else {
        m.vx = m.vz = 0;
      }
    }
    m.vy -= M.WRECK_GRAVITY;
    m.y += m.vy;
    if (m.y <= m.floorY) {
      m.y = m.floorY;
      m.vy = 0;
      m.vx *= 0.5;
      m.vz *= 0.5;
      if (m.vx * m.vx + m.vz * m.vz < 1) m.vx = m.vz = 0;
    }
    m.roll = Math.PI * smooth(m.t / M.FLIP_TICKS);
    m.pitch *= 0.8;
    m.phase += 0.9;
    m.stride = m.t < 24 ? 1 : 1 - (m.t - 24) / 16;
    m.power = m.t < 14 && (m.t >> 1) % 2 === 0 ? 0.6 : 0;
    this._sparks(m);
    if (m.t >= M.WRECK) {
      m.state = 'vanish';
      m.t = 0;
    }
  }

  _vanish(m) {
    const M = MINION;
    m.scale = 1 - m.t / M.VANISH;
    if (m.t === 1) this.sparkles?.clods({ x: m.x, y: m.y + 30, z: m.z }, this.tick * FRAME_DT, TINT.scrap, 8, 0.6);
    if (m.t >= M.VANISH) {
      if (m.drop && this.onCoin) this.onCoin(m.x, m.y, m.z);
      m.scale = 1;
      this._free(m);
    }
  }

  // Sparks spitting from a fresh wreck.
  _sparks(m) {
    const fire = this.fire;
    if (!fire || m.t > 18 || (m.t & 1) === 1) return;
    const rng = this.rng;
    const t0 = this.tick * FRAME_DT;
    for (let k = 0; k < 3; k++) {
      const p = fire.spawn(t0, 0.35 + rng() * 0.35, FIRE.SPARK);
      if (!p) return;
      p.x = m.x + (rng() - 0.5) * 70;
      p.y = m.y + 30 + rng() * 30;
      p.z = m.z + (rng() - 0.5) * 70;
      p.vx = (rng() - 0.5) * 420;
      p.vy = 250 + rng() * 350;
      p.vz = (rng() - 0.5) * 420;
      p.gy = -1400;
      p.size0 = 34 + rng() * 16;
      p.size1 = 8;
      p.ramp = RAMP.spark;
    }
  }

  // ------------------------------------------------------------------ render

  animate(alpha, clock, camera = null) {
    const list = this.list;
    const M = MINION;
    const A = MINION_ANIM;
    const R = MINION_RIG;
    const mesh = this.mesh;
    const a4 = this.anim.array;
    const b4 = this.anim2.array;
    const fire = this.fire;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.state === 'free') continue;
      const x = m.px + (m.x - m.px) * alpha;
      const y = m.py + (m.y - m.py) * alpha;
      const z = m.pz + (m.z - m.pz) * alpha;
      const yaw = m.pyaw + wrapAngle(m.yaw - m.pyaw) * alpha;
      const pitch = m.ppitch + (m.pitch - m.ppitch) * alpha;
      const roll = m.proll + (m.roll - m.proll) * alpha;
      const sink = m.psink + (m.sink - m.psink) * alpha;
      const scale = m.pscale + (m.scale - m.pscale) * alpha;
      const power = m.ppower + (m.power - m.ppower) * alpha;
      const flare = m.pflare + (m.flare - m.pflare) * alpha;
      const phase = m.pphase + (m.phase - m.pphase) * alpha;
      const stride = m.pstride + (m.stride - m.pstride) * alpha;
      const tilt = m.ptilt + (m.tilt - m.ptilt) * alpha;
      const crouch = m.pcrouch + (m.crouch - m.pcrouch) * alpha;
      _e.set(pitch, yaw, roll, 'YXZ');
      _q.setFromEuler(_e);
      _o.set(0, M.PIVOT * scale, 0).applyQuaternion(_q);
      _p.set(x - _o.x, y + sink + M.PIVOT * scale - _o.y, z - _o.z);
      _s.set(scale, scale, scale);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(n, _m);
      a4[n * 4] = phase;
      a4[n * 4 + 1] = stride;
      a4[n * 4 + 2] = tilt;
      a4[n * 4 + 3] = clock * (m.state === 'windup' ? 19 : 6) + m.seed * TAU;
      b4[n * 4] = power;
      b4[n * 4 + 1] = flare;
      b4[n * 4 + 2] = m.state === 'windup' ? 0.45 : m.state === 'wrecked' ? 0.8 : 0.15 + 0.2 * stride;
      b4[n * 4 + 3] = crouch;
      n++;
      // Blob shadow (not while underground).
      if (this.shadows) {
        if (sink > -60 && m.floorN) {
          const h = y + sink - m.floorY;
          this.shadows.place(this.shadowBase + m.i, x, m.floorY, z, m.floorN ?? UP, shadowSize(M.SHADOW * scale, h > 0 ? h : 0));
          m.shadow = true;
        } else if (m.shadow) {
          this.shadows.hide(this.shadowBase + m.i);
          m.shadow = false;
        }
      }
      // Two eye glows, following the cap's tilt and bob (as the vertex shader moves it), each
      // pulled toward the camera so the lens ring does not hide it.
      if (fire && power > 0.05) {
        const ta = tilt * A.TILT;
        const c = Math.cos(ta);
        const sn = Math.sin(ta);
        const ey = R.EYE[1] - R.CAP_PIVOT;
        const ez = R.EYE[2];
        const lift = stride * (A.BOB * Math.cos(3 * phase) + A.CAP_BOB * Math.cos(3 * phase - 0.9)) - crouch * A.CROUCH;
        const ry = R.CAP_PIVOT + c * ey - sn * ez + lift - M.PIVOT;
        const rz = sn * ey + c * ez;
        for (let side = -1; side <= 1; side += 2) {
          const g = fire.glowSlot();
          if (!g) break;
          _o.set(side * R.EYE[0], ry, rz).multiplyScalar(scale).applyQuaternion(_q);
          let gx = x + _o.x;
          let gy = y + sink + M.PIVOT * scale + _o.y;
          let gz = z + _o.z;
          if (camera) {
            const cx = camera.position.x - gx;
            const cy = camera.position.y - gy;
            const cz = camera.position.z - gz;
            const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
            if (len > 120) {
              gx += (cx / len) * 24;
              gy += (cy / len) * 24;
              gz += (cz / len) * 24;
            }
          }
          g.x = gx;
          g.y = gy;
          g.z = gz;
          g.size = (46 + 32 * flare) * scale;
          g.r = TINTS.eye[0];
          g.g = TINTS.eye[1];
          g.b = TINTS.eye[2];
          g.a = power * (0.75 + 0.25 * flare);
        }
      }
    }
    mesh.count = n;
    mesh.visible = n > 0;
    if (n > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      this.anim.needsUpdate = true;
      this.anim2.needsUpdate = true;
    }
  }
}
