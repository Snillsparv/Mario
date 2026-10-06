// The Midsummer critters of Midsummer Skerries (layout.CRITTERS): small original enemies that
// live on the course, each guarding the fight circle round its home on its own level: Wreath
// Frogs (critters/frog.js) and Mosquitoes (critters/mosquito.js) on Home Island's meadow, Tin
// Crabs (critters/crab.js) on the sand bar in the Sound and on the islet. Their looks are in
// critterModel.js.
//
//   new Critters({ spots, collision, events, sparkles?, shadows?, shadowBase?, onCoin? })
//        spots: layout.CRITTERS in world coordinates, [{ id, kind: 'frog' | 'crab' | 'mosquito',
//        x, y (its floor), z, yaw, roam, fight, calm?, wade?, scale?, stand? }] (any other kind
//        throws); onCoin(x, floorY, z, minY): a defeated critter's coin (ObjectManager.spawnCoin)
//   update(player, hero, tick, hold?, cameraYaw?)   30 Hz (ObjectManager, after the cannon);
//                                       hero = the previous tick's { y, vy, air } (or null);
//                                       hold: a dialog is up or a warp runs (he counts as away:
//                                       no windups, no damage); cameraYaw: the camera's look yaw
//                                       (a struck critter is knocked off its line of sight)
//   animate(alpha, clock)               render: instance matrices and channels, blob shadows,
//                                       the danger markers (works before any update)
//   reset()                             every critter home and calm, the defeated back (an
//                                       arrival, GAME OVER); the life counter back to 0
//   sendHome()                          the live ones home and calm (a lost life)
//   mesh, markers                       'critters' (one instanced draw) and 'critterMarkers'
//                                       (a second one, only while a marker shows)
//   alive, engaged, hits, list, byId(id)   live ones, engaged ones, wedges they took; the records
//
// Fair for a child (docs/ARCHITECTURE.md "Critters"):
//   F1 nothing hurts by touch: only a strike (the frog's landing, the crab's pinch, the
//      mosquito's needle on the marked spot), 1 wedge, at most once a strike
//      (player.takeDamage(1, fromPos)); touching one is a harmless bump that moves the critter
//      (never Jonas) aside: it skips away, or is pushed out to arm's length (round him where it
//      cannot go straight on), so he never stands inside one;
//   F2 every strike is told at least 20 ticks ahead (motion, glow, sound), its target or heading
//      locked at least 9 ticks before it can hurt, an orange ring on the ground where it lands;
//   F3 one attacker at a time: a token taken at a windup and given back as the strike ends,
//      then GAP ticks before the next windup;
//   F4 nothing happens while he is away (AWAY: reading, dying, dropping in, dancing with a star,
//      on a pole or a ledge, in the cannon, swinging Rustmaw, swimming; in the water; a dialog
//      or a warp): no engagement, no new windup, a windup under way is called off, a strike in
//      flight does no damage; no windup either while he blinks after a hit;
//   F5 he wins a tie: his attack and his stomp are tested before the critter's own step, and
//      again inside a strike where it has carried the critter, before it may hurt him;
//   F6 a hit never knocks him off his level or into the water: his natural landing is probed
//      (145 and 290 along the knockback) and, where unsafe, fromPos sends him toward home
//      (round the critter where it stands in that way);
//   F7 never near a route (the placements, tests/skerries.test.js);
//   F8 one stomp or one hit defeats any critter (in every live state), dropping one coin.
// Engagement: a calm critter whose circle he comes into (on its level: his floor within LEVEL of
// its home's) notices him; it is let go after RELEASE ticks of him beyond fight + OUT, off its
// level or away, and goes home (a strike under way finishes first). Its body never leaves fight
// + its kind's LEASH of home. A lost life (the 'spawn' edge seen here, never the global
// 'lifeLost', which every area's manager hears) sends the live ones home; a defeat under way
// still drops its coin.
//
// Order each tick (load-bearing): the life counter, the spawn edge, his attack read once; then
// per critter: its hit tests (struck, stomped), the engagement, the bump, its kind's step.
// Determinism: no Math.random and no rng stream: every choice is noise(seed + life counter), so
// a reset manager replays exactly. Idle critters make no collision queries, no sparkles; the
// idle sounds are rare and quiet. Allocation: collision results and 'sfx' payloads only; the
// render path allocates nothing.

import * as THREE from 'three';
import { FRAME_DT, PLAYER_RADIUS } from '../core/constants.js';
import { TAU, wrapAngle } from '../core/math.js';
import { CRITTER_RIG, MODEL, makeCritterGeometry, makeCritterMaterial, makeMarkerMesh } from './critterModel.js';
import { frog, FROG } from './critters/frog.js';
import { crab, CRAB } from './critters/crab.js';
import { mosquito, MOSQUITO } from './critters/mosquito.js';
import { AWAY, heroInvincible } from './hurt.js';
import { KINDS as OBJECT_KINDS } from './kinds.js';
import { TINT } from './Sparkles.js';
import { shadowSize } from './BlobShadows.js';

const SHARED = {
  GAP: 40, // ticks after a strike before the next windup (any critter)
  RELEASE: 20, // ticks of him out (beyond fight + OUT, off level, away) before it lets go
  OUT: 80,
  LEVEL: 60, // his floor within this of its home's: on its level
  SOUND_GAP: 45, // an idle sound waits this long after any critter sound
  KNOCK_NEAR: 145, // his natural landing probed this far and ...
  KNOCK_FAR: 290, // ... this far along the knockback (it carries him about 286)
  KNOCK_DY: 60, // a landing more than this off his floor is unsafe
  WADE_DEEP: 95, // at a wading spot, water deeper than this is unsafe
  REDIRECT: 100, // fromPos this far from him, away from home: he flies toward home ...
  KNOCK_ROUND: 0.5, // ... or, where it stands in that way, turned round it this far (radians) at a time
  KNOCK_TURN: 0.7, // a struck critter knocked away from the camera goes this far (radians) aside
  BUMP_STEP: 24, // a bump moves it at most this far a tick more than he moves
  POOF: 8, // a defeated critter shrinks away in this many ticks, then its coin
  POOF_RISE: 2,
  WADE_COIN: 50, // a wading critter's coin floats this high over the water
  STEP_UP: 40,
  FLOOR_DY: 40, // a floor it moves onto lies within this of its home's
  HERO_LOW: -10, // his capsule (for strikes): feet + HERO_LOW .. feet + HERO_HIGH, PLAYER_RADIUS
  HERO_HIGH: 170,
  STOMP_LOW: 40, // a stomp: his feet no lower than this under its origin (times its scale)
  WALL_Y: 30,
  WALL_R: 45,
};

// Each kind's numbers live with its steps (critters/*.js).
export const CRITTER = { SHARED, FROG, CRAB, MOSQUITO };

// F4: actions in which he is away (objects/hurt.js; LaneBoss.js asks it too).
export { AWAY };

// Every state of every kind: calm (C: at home, not after him), engaged (E) or a defeat (D; 'gone'
// is the end of one: nothing drawn). HITTABLE = every non-defeat state (F8 holds in all of them).
export const STATES = {
  frog: { idle: 'C', notice: 'E', approach: 'E', windup: 'E', leap: 'E', dazed: 'E', cooldown: 'E', return: 'C', squash: 'D', poof: 'D', tumble: 'D', gone: 'D' },
  crab: { hidden: 'C', wake: 'E', strafe: 'E', windup: 'E', pinch: 'E', stuck: 'E', cooldown: 'E', return: 'C', hide: 'C', dent: 'D', poof: 'D', tumble: 'D', gone: 'D' },
  mosquito: { patrol: 'C', spot: 'E', chase: 'E', aim: 'E', dive: 'E', recoil: 'E', rise: 'E', stuck: 'E', pull: 'E', cooldown: 'E', return: 'C', splat: 'D', fall: 'D', deflate: 'D', poof: 'D', gone: 'D' },
};
const table = (mark) => {
  const out = {};
  for (const kind of Object.keys(STATES)) for (const [s, m] of Object.entries(STATES[kind])) if (mark.includes(m)) out[s] = 1;
  return out;
};
export const HITTABLE = table('CE');
const CALM = table('C');
const ENGAGED = table('E');
// Never bumped mid-strike, nor in the mosquito's aim (its tell flies a set path); never let go
// mid-strike or in the stomp window or the recoil after it (it finishes, then goes home: a
// pinch or a dive let go would keep the token and its ring).
const NO_BUMP = { leap: 1, pinch: 1, aim: 1, dive: 1 };
// A bump has pushed it clear when it ends at least this part (squared: 0.8) of arm's length from
// him; where it may not go straight out, it tries turns of BUMP_TURN (22.5 degrees) round him.
const BUMP_CLEAR = 0.64;
const BUMP_TURN = Math.PI / 8;
const NO_RELEASE = { leap: 1, dazed: 1, pinch: 1, stuck: 1, dive: 1, recoil: 1, pull: 1 };
// Actions that never stomp (knocked back or burnt, dying, dropping in, reading).
const NO_STOMP = { hurt: 1, burn: 1, death: 1, spawn: 1, spawn_land: 1, reading: 1 };

// Per kind (MODEL's order): its code, its steps, its numbers (LEASH; MARK_FROM and MARK_TO, its
// danger ring's size across from the lock to the strike) and its landmarks.
const KIND_CODE = { frog: MODEL.FROG, crab: MODEL.CRAB, mosquito: MODEL.MOSQUITO };
const KINDS = [frog, crab, mosquito];
const NUMBERS = [FROG, CRAB, MOSQUITO];
const RIGS = [CRITTER_RIG.frog, CRITTER_RIG.crab, CRITTER_RIG.mosquito];
// The part of the ring's growth it shows steady at full brightness (about a frog's first 8
// ticks).
const MARK_STEADY = 0.3;

// Cheap deterministic noise in 0..1 (Minions' noise).
const noise = (n) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

function record(i, spot) {
  const kind = KIND_CODE[spot.kind];
  if (kind === undefined) throw new Error(`critters: unknown kind '${spot.kind}' (${spot.id})`);
  const fight = spot.fight ?? 400;
  const leash = fight + NUMBERS[kind].LEASH;
  const out = fight + SHARED.OUT;
  return {
    i,
    kind,
    id: spot.id ?? `critter${i}`,
    seed: i * 7.13 + kind,
    scale: spot.scale ?? 1,
    stand: spot.stand ?? 0,
    calm: spot.calm ?? 1,
    wade: spot.wade ? 1 : 0,
    roam: spot.roam ?? 200,
    hx: spot.x,
    hy: spot.y,
    hz: spot.z,
    fight2: fight * fight,
    relR2: out * out,
    leash2: leash * leash,
    yaw0: spot.yaw ?? 0,
    state: 'idle',
    t: 0,
    next: 0, // life tick of its next move (an idle or approach hop)
    k: 0, // its idle ring point
    dir: 1,
    cooldown: 0, // no windup until 0
    engaged: 0,
    outFor: 0, // ticks he has been out of reach (RELEASE)
    struck: 0, // this strike has hurt him
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
    sq: 1, // squash (height; it widens to match)
    psq: 1,
    vis: 1, // size while it poofs away (or deflates) ...
    pvis: 1,
    shrink: 1, // ... and as the poof began
    a0: 0, // the instance channels (CRITTER_ANIM)
    pa0: 0,
    a1: 0,
    pa1: 0,
    a2: 0,
    pa2: 0,
    a3: 0,
    pa3: 0,
    b0: 0,
    pb0: 0,
    b1: 0,
    pb1: 0,
    glow: 0,
    pglow: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    sx0: 0, // where its strike started (the frog's leap, the mosquito's aim, then its dive)
    sy0: 0,
    sz0: 0,
    tx: 0, // its target (a hop's landing, the locked strike spot)
    ty: 0,
    tz: 0,
    n: 0, // air ticks left
    lockYaw: 0,
    floorY: 0, // the floor under it, and its normal
    nx: 0,
    ny: 1,
    nz: 0,
    markOn: 0, // the danger ring: shown at (tx, markY, tz), tilted to (mnx, mny, mnz)
    markY: 0,
    mnx: 0,
    mny: 1,
    mnz: 0,
    mark: 0, // ... grown this far (0 at the lock, 1 at the strike)
    pmark: 0,
    dropX: 0, // where its coin appeared
    dropY: 0,
    dropZ: 0,
    blinkAt: 0, // life ticks of its next blink (a crab's peek) and idle call
    croakAt: 0,
    hopX: new Float64Array(6), // its idle ring (checked once) ...
    hopY: new Float64Array(6),
    hopZ: new Float64Array(6),
    hopN: 0, // ... and how many points it kept
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _o = new THREE.Vector3();
const _v = new THREE.Vector3();
const _col = new THREE.Color();
const _n = { x: 0, y: 1, z: 0 };
const _pt = { x: 0, y: 0, z: 0 }; // sparkle spots (Sparkles copies them)
const _w = { x: 0, y: 0, z: 0 }; // a rig point in the world (_at)
const UP = new THREE.Vector3(0, 1, 0);

export class Critters {
  constructor({ spots, collision, events, sparkles = null, shadows = null, shadowBase = -1, onCoin = null }) {
    this.collision = collision;
    this.events = events;
    this.sparkles = sparkles;
    this.shadows = shadows;
    this.shadowBase = shadowBase;
    this.onCoin = onCoin;
    this.life = 0; // its own tick counter (reset() sets it back: a reset manager replays)
    this.tick = 0; // the objects' tick (sparkle times)
    this.hits = 0; // wedges they took off him
    this.attacker = -1; // the token: the record striking (or -1) ...
    this.gapUntil = 0; // ... and no windup before this life tick
    this.lastSfxLife = -1e9; // the life tick of the last critter sound
    this._lastAction = null; // his action last tick (the spawn edge)
    // This tick's: him, his attack (read once), whether he is away / fightable, his floor.
    this.player = null;
    this.attack = null;
    this.hero = null;
    this.away = false;
    this.fightable = false;
    this.heroFloorY = 0;
    this.cameraYaw = null; // the camera's look yaw this tick (or null)
    this._from = { x: 0, y: 0, z: 0 }; // fromPos for takeDamage (reused)
    this.list = spots.map((s, i) => record(i, s));
    // Each home's floor, once; the frogs' idle rings.
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      const f = collision.findFloor(c.hx, c.hy + 60, c.hz);
      if (f.surface) {
        c.hy = f.y;
        c.nx = f.surface.normal.x;
        c.ny = f.surface.normal.y;
        c.nz = f.surface.normal.z;
      }
      if (c.kind === MODEL.FROG) frog.ring(this, c, spots[i]);
    }
    const capacity = Math.max(1, this.list.length);
    const geo = makeCritterGeometry(capacity);
    this.anim = geo.attributes.aAnim;
    this.anim2 = geo.attributes.aAnim2;
    this._mesh = new THREE.InstancedMesh(geo, makeCritterMaterial(), capacity);
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._mesh.name = 'critters';
    this._mesh.frustumCulled = false;
    this._markers = makeMarkerMesh(capacity);
    this.reset();
    this.animate(1, 0);
  }

  get mesh() {
    return this._mesh;
  }

  get markers() {
    return this._markers;
  }

  // Critters up and about (not defeated).
  get alive() {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) if (HITTABLE[this.list[i].state] === 1) n++;
    return n;
  }

  // Critters after him (or striking, dazed, cooling off).
  get engaged() {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) if (ENGAGED[this.list[i].state] === 1) n++;
    return n;
  }

  // The record of spot `id` (tests, shot recipes), or null.
  byId(id) {
    for (let i = 0; i < this.list.length; i++) if (this.list[i].id === id) return this.list[i];
    return null;
  }

  // Every critter home and calm, the defeated back, the clocks and the token as new (an
  // arrival, GAME OVER).
  reset() {
    this.life = 0;
    this._lastAction = null;
    this.attacker = -1;
    this.gapUntil = 0;
    this.lastSfxLife = -1e9;
    this.hits = 0;
    for (let i = 0; i < this.list.length; i++) this._home(this.list[i]);
  }

  // A lost life: the live critters snap home, calm; the token is free; the defeated stay gone
  // (one being defeated finishes and drops its coin).
  sendHome() {
    for (let i = 0; i < this.list.length; i++) if (HITTABLE[this.list[i].state] === 1) this._home(this.list[i]);
    this.attacker = -1;
    this.gapUntil = this.life + SHARED.GAP;
  }

  _home(c) {
    c.engaged = 0;
    c.outFor = 0;
    c.struck = 0;
    c.cooldown = 0;
    c.markOn = 0;
    c.mark = 0;
    c.n = 0;
    c.pitch = 0;
    c.roll = 0;
    c.sq = 1;
    c.vis = 1;
    c.shrink = 1;
    KINDS[c.kind].home(this, c);
    this._save(c);
  }

  update(player, hero, tick, hold = false, cameraYaw = null) {
    this.life++;
    this.tick = tick;
    this.cameraYaw = cameraYaw;
    // A lost life: he drops in again ('spawn'), the live critters go home.
    if (player.action === 'spawn' && this._lastAction !== 'spawn') this.sendHome();
    this._lastAction = player.action ?? null;
    const atk = player.getAttack ? player.getAttack() : null;
    this.attack = atk;
    this.player = player;
    this.hero = hero;
    this.away = hold || player.inWater === true || AWAY[player.action] === 1;
    this.fightable = !this.away && !heroInvincible(player);
    const f = player.floor;
    this.heroFloorY = f && f.surface ? f.y : player.pos.y;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.state === 'gone') continue;
      this._save(c);
      c.t++;
      if (HITTABLE[c.state] === 1) {
        // F5: his attack and his stomp first.
        if (atk !== null && this._struck(c, atk)) {
          this._defeat(c, false);
          continue;
        }
        if (this._stomped(c, player, hero) && this._bounce(c)) {
          this._defeat(c, true);
          continue;
        }
        this._engage(c);
        if (HITTABLE[c.state] === 1) this._bump(c);
      }
      KINDS[c.kind].step(this, c, player, hero);
    }
  }

  _save(c) {
    c.px = c.x;
    c.py = c.y;
    c.pz = c.z;
    c.pyaw = c.yaw;
    c.ppitch = c.pitch;
    c.proll = c.roll;
    c.psq = c.sq;
    c.pvis = c.vis;
    c.pa0 = c.a0;
    c.pa1 = c.a1;
    c.pa2 = c.a2;
    c.pa3 = c.a3;
    c.pb0 = c.b0;
    c.pb1 = c.b1;
    c.pglow = c.glow;
    c.pmark = c.mark;
  }

  // ------------------------------------------------------------------ engagement

  // A calm critter whose circle he is in (on its level, not away) notices him; an engaged one is
  // let go after RELEASE ticks of him out (beyond fight + OUT, off its level, away), but not
  // mid-strike or in the daze after it, nor in the air (a hop lands first).
  _engage(c) {
    const p = this.player.pos;
    const dx = p.x - c.hx;
    const dz = p.z - c.hz;
    const d2 = dx * dx + dz * dz;
    const dy = this.heroFloorY - c.hy;
    const onLevel = dy <= SHARED.LEVEL && dy >= -SHARED.LEVEL;
    if (CALM[c.state] === 1) {
      if (!this.away && onLevel && d2 < c.fight2) this._notice(c);
      return;
    }
    if (ENGAGED[c.state] !== 1) return;
    if (this.away || !onLevel || d2 > c.relR2) c.outFor++;
    else c.outFor = 0;
    if (c.outFor >= SHARED.RELEASE && NO_RELEASE[c.state] !== 1 && c.n === 0) {
      c.engaged = 0;
      c.outFor = 0;
      KINDS[c.kind].release(this, c);
    }
  }

  _notice(c) {
    c.engaged = 1;
    c.outFor = 0;
    KINDS[c.kind].notice(this, c);
  }

  // Is he (not away) on its level within r of its home? (A hidden crab watches him.)
  _near(c, r) {
    const dy = this.heroFloorY - c.hy;
    if (this.away || dy > SHARED.LEVEL || dy < -SHARED.LEVEL) return false;
    const p = this.player.pos;
    const dx = p.x - c.hx;
    const dz = p.z - c.hz;
    return dx * dx + dz * dz < r * r;
  }

  // Touching one is a harmless bump: a live critter he walks or jumps into (on its level, his
  // body reaching its body: his feet below its top, his head above a hovering mosquito's
  // underside) moves aside; never in its strike or the mosquito's aim, nor while he is knocked
  // back (the hit throws him round it). A calm one notices him; its kind may have it skip away
  // (bumped(): the frog hops off); else it is pushed out to arm's length along the line from him
  // (a hovering mosquito's arm's length short of its stomp reach, so a jump beside it still lands
  // on it; a stuck one's a little longer), or, where it may not go (its leash, a wall, off its
  // floor, the water), round him by the least turn it may take (BUMP_TURN at a time up to 90
  // degrees, either side, toward home first), so it slides along the rim or the wall instead of
  // ending up inside him; at most BUMP_STEP a tick more than he moves: sliding round him takes a
  // few ticks, never a jump. Even while he dies it is pushed out (one that just landed its strike
  // on him), nothing more.
  _bump(c) {
    const player = this.player;
    if (NO_BUMP[c.state] === 1 || player.action === 'hurt' || (this.away && player.action !== 'death')) return;
    const R = RIGS[c.kind];
    const p = player.pos;
    const dy = this.heroFloorY - c.hy;
    if (dy > SHARED.LEVEL || dy < -SHARED.LEVEL || p.y >= c.y + (R.TOP + this._rise(c)) * c.scale) return;
    const fly = c.kind === MODEL.MOSQUITO;
    if (fly && p.y + SHARED.HERO_HIGH <= c.y - R.UNDER * c.scale) return;
    const reach = PLAYER_RADIUS + (fly && c.state === 'stuck' ? R.STUCK_R : R.BUMP_R) * c.scale;
    let dx = c.x - p.x;
    let dz = c.z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= reach * reach) return;
    const d = Math.sqrt(d2);
    if (d > 1) {
      dx /= d;
      dz /= d;
    } else {
      dx = -Math.sin(c.yaw);
      dz = -Math.cos(c.yaw);
    }
    if (!this.away) {
      if (CALM[c.state] === 1) this._notice(c);
      if (KINDS[c.kind].bumped(this, c, dx, dz)) return;
    }
    // (Straight out, then 22.5, 45, 67.5 and 90 degrees round him, toward home first: the least
    // turn it may take, so pressed on along a rim it slides round him a little each tick; a push
    // a wall stops short still counts as refused.)
    const x0 = c.x;
    const z0 = c.z;
    const s = (c.hx - p.x) * dz - (c.hz - p.z) * dx > 0 ? 1 : -1;
    for (let k = 0; k < 9; k++) {
      const a = ((k + 1) >> 1) * BUMP_TURN * (k % 2 === 1 ? s : -s);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      if (!this._move(c, p.x + (dx * ca + dz * sa) * reach, p.z + (dz * ca - dx * sa) * reach)) continue;
      const ex = c.x - p.x;
      const ez = c.z - p.z;
      if (ex * ex + ez * ez >= BUMP_CLEAR * reach * reach) break;
    }
    // Only BUMP_STEP of that way this tick more than his own pace, the rest next tick.
    let step = SHARED.BUMP_STEP;
    const v = player.vel;
    if (v) step += Math.sqrt(v.x * v.x + v.z * v.z);
    const mx = c.x - x0;
    const mz = c.z - z0;
    const m2 = mx * mx + mz * mz;
    if (m2 > step * step) {
      const f = step / Math.sqrt(m2);
      this._move(c, x0 + mx * f, z0 + mz * f);
    }
  }

  // Moves it on its floor to (x, z) when it may stand there: within its leash, out of the walls
  // (one findWalls), on its level, dry (one findFloor, the water there). Returns whether it did.
  _move(c, x, z) {
    const col = this.collision;
    const hx = x - c.hx;
    const hz = z - c.hz;
    if (hx * hx + hz * hz > c.leash2) return false;
    const w = col.findWalls(x, c.y, z, SHARED.WALL_Y, RIGS[c.kind].BUMP_R * c.scale);
    const f = col.findFloor(w.x, c.y + SHARED.STEP_UP, w.z);
    if (!this._standable(c, f, w.x, w.z, SHARED.FLOOR_DY)) return false;
    c.x = w.x;
    c.z = w.z;
    if (c.n === 0 && c.y <= c.floorY + 0.5) {
      c.y = f.y;
      c.floorY = f.y;
      c.nx = f.surface.normal.x;
      c.ny = f.surface.normal.y;
      c.nz = f.surface.normal.z;
    }
    return true;
  }

  // Whether a floor found at (x, z) is one it may stand on: there, not deadly, within dy of its
  // home's, dry enough (_dry).
  _standable(c, f, x, z, dy) {
    if (!f.surface || f.surface.surface === 'death') return false;
    const h = f.y - c.hy;
    if (h > dy || h < -dy) return false;
    return this._dry(c, x, z, f.y);
  }

  // Is a floor at height y at (x, z) dry enough for it (and for him, knocked back by it): the water
  // 10 or more under it, or at a wading spot at most WADE_DEEP over it?
  _dry(c, x, z, y) {
    const col = this.collision;
    const water = col.waterLevelAt ? col.waterLevelAt(x, z) : -Infinity;
    return c.wade === 1 ? water - y <= SHARED.WADE_DEEP : water <= y - 10;
  }

  // The floor at (x, z) if it is on its level (within dy) and dry enough, else null.
  _floorAt(c, x, z, dy) {
    const f = this.collision.findFloor(x, c.hy + 60, z);
    return this._standable(c, f, x, z, dy) ? f : null;
  }

  // ------------------------------------------------------------------ hops (frog)

  // Up into a hop: `n` air ticks to (tx, ty, tz) under `g`, landing on its last tick.
  _launch(c, tx, ty, tz, n, g) {
    c.tx = tx;
    c.ty = ty;
    c.tz = tz;
    c.n = n;
    c.vx = (tx - c.x) / n;
    c.vz = (tz - c.z) / n;
    c.vy = (ty - c.y) / n + (g * (n - 1)) / 2;
  }

  // A hop's take-off toward (x, z), `n` air ticks: pulled inside the leash (a hop `back`, away
  // from him, the leash or a wall there simply refuses), onto its level and dry (one findFloor;
  // else no hop). Returns whether it hopped.
  _hop(c, x, z, back, n) {
    const col = this.collision;
    let hx = x - c.hx;
    let hz = z - c.hz;
    const h2 = hx * hx + hz * hz;
    if (h2 > c.leash2) {
      if (back) return false;
      const k = Math.sqrt(c.leash2 / h2);
      hx *= k;
      hz *= k;
      x = c.hx + hx;
      z = c.hz + hz;
    }
    if (back && col.findWalls(x, c.y, z, SHARED.WALL_Y, SHARED.WALL_R).walls.length > 0) return false;
    const f = this._floorAt(c, x, z, SHARED.FLOOR_DY);
    if (f === null) return false;
    this._launch(c, x, f.y, z, n, FROG.GRAVITY);
    c.nx = f.surface.normal.x;
    c.ny = f.surface.normal.y;
    c.nz = f.surface.normal.z;
    return true;
  }

  // One air tick's way along: one findWalls; a wall stops it (it drops on, over its floor).
  _fly(c, wallY, wallR) {
    const w = this.collision.findWalls(c.x + c.vx, c.y, c.z + c.vz, wallY, wallR * c.scale);
    if (w.walls.length > 0) {
      c.vx = 0;
      c.vz = 0;
    }
    c.x = w.x;
    c.z = w.z;
  }

  // The strike's target T at (x, z) if it is on its level (within dy) and dry: the danger ring
  // goes there. Returns whether it is.
  _markAt(c, x, z, dy) {
    const f = this._floorAt(c, x, z, dy);
    if (f === null) return false;
    c.tx = x;
    c.ty = f.y;
    c.tz = z;
    c.markOn = 1;
    c.markY = f.y;
    c.mnx = f.surface.normal.x;
    c.mny = f.surface.normal.y;
    c.mnz = f.surface.normal.z;
    c.mark = 0;
    c.pmark = 0; // (a strike before left it full grown: never drawn shrinking from there)
    return true;
  }

  // ------------------------------------------------------------------ the token

  _tokenFree() {
    return this.attacker === -1 && this.life >= this.gapUntil;
  }

  _takeToken(c) {
    this.attacker = c.i;
  }

  // Given back (a strike's end, a cancel, a defeat): GAP ticks before the next windup.
  _freeToken(c) {
    if (this.attacker !== c.i) return;
    this.attacker = -1;
    this.gapUntil = this.life + SHARED.GAP;
  }

  // ------------------------------------------------------------------ hurting him

  // F5 inside a strike too: his attack and his stomp are tested again where the strike has
  // carried it this tick (a lunge or a dive into his punch, a leap or a dive up under his
  // feet) before it may hurt him. True when that defeated it.
  _parried(c) {
    if (this.attack !== null && this._struck(c, this.attack)) {
      this._defeat(c, false);
      return true;
    }
    if (!this._stomped(c, this.player, this.hero) || !this._bounce(c)) return false;
    this._defeat(c, true);
    return true;
  }

  // He bounces off its top (bounce(72) off a frog's trampoline belly, the default off the
  // others); false when he will not (Player.bounce refuses).
  _bounce(c) {
    const p = this.player;
    return !p.bounce || p.bounce(c.kind === MODEL.FROG ? FROG.BOUNCE : undefined) !== false;
  }

  // Does a sphere (cx, cy, cz, r) touch his body (a capsule from his feet up)?
  _touches(cx, cy, cz, r) {
    const p = this.player.pos;
    const dx = cx - p.x;
    const dz = cz - p.z;
    const rr = PLAYER_RADIUS + r;
    return dx * dx + dz * dz <= rr * rr && cy >= p.y + SHARED.HERO_LOW - r && cy <= p.y + SHARED.HERO_HIGH + r;
  }

  // The strike from (sx, sy, sz) hurts him: 1 wedge (never while he is away or blinking, at most
  // once a strike). F6: his natural knockback (away from the strike) is probed at KNOCK_NEAR and
  // KNOCK_FAR; where it would carry him off his level, onto nothing or into the water, fromPos
  // sends him toward home instead (along the critter's facing when he stands on it), and where
  // the critter stands in that way (he would fly into it), turned round it, KNOCK_ROUND at a time
  // (up to 3 times; away from its side first) to the first way that is clear of it and lands
  // safely (else home after all). takeDamage plays the hurt sound (the strike's own has played
  // already).
  _hurt(c, sx, sy, sz) {
    if (!this.fightable || c.struck === 1) return false;
    const player = this.player;
    const p = player.pos;
    let ux = p.x - sx;
    let uz = p.z - sz;
    const len = Math.sqrt(ux * ux + uz * uz);
    if (len > 1) {
      ux /= len;
      uz /= len;
    } else {
      ux = Math.sin(c.yaw);
      uz = Math.cos(c.yaw);
    }
    const from = this._from;
    if (this._safe(c, p.x + ux * SHARED.KNOCK_NEAR, p.z + uz * SHARED.KNOCK_NEAR) && this._safe(c, p.x + ux * SHARED.KNOCK_FAR, p.z + uz * SHARED.KNOCK_FAR)) {
      from.x = sx;
      from.y = sy;
      from.z = sz;
    } else {
      let hx = c.hx - p.x;
      let hz = c.hz - p.z;
      const l = Math.sqrt(hx * hx + hz * hz);
      if (l > 1) {
        hx /= l;
        hz /= l;
      } else {
        hx = Math.sin(c.yaw);
        hz = Math.cos(c.yaw);
      }
      if (this._inWay(c, hx, hz)) {
        // (Turning by a grows its distance from the line on the side it is on: that way first,
        // then the other at each turn.)
        const s = hx * (c.z - p.z) - hz * (c.x - p.x) >= 0 ? 1 : -1;
        for (let k = 1; k <= 6; k++) {
          const a = ((k + 1) >> 1) * SHARED.KNOCK_ROUND * (k % 2 === 1 ? s : -s);
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const vx = hx * ca + hz * sa;
          const vz = hz * ca - hx * sa;
          if (this._inWay(c, vx, vz) || !this._safe(c, p.x + vx * SHARED.KNOCK_NEAR, p.z + vz * SHARED.KNOCK_NEAR) || !this._safe(c, p.x + vx * SHARED.KNOCK_FAR, p.z + vz * SHARED.KNOCK_FAR)) continue;
          hx = vx;
          hz = vz;
          break;
        }
      }
      from.x = p.x - hx * SHARED.REDIRECT;
      from.y = p.y;
      from.z = p.z - hz * SHARED.REDIRECT;
    }
    if (player.takeDamage && player.takeDamage(1, from)) {
      c.struck = 1;
      this.hits++;
      return true;
    }
    return false;
  }

  // Is (x, z) a safe landing for him: a floor within KNOCK_DY of his, not deadly, dry (at a
  // wading spot: water at most WADE_DEEP over it)?
  _safe(c, x, z) {
    const y = this.heroFloorY;
    const f = this.collision.findFloor(x, y + 100, z);
    if (!f.surface || f.surface.surface === 'death') return false;
    if (f.y - y > SHARED.KNOCK_DY || y - f.y > SHARED.KNOCK_DY) return false;
    return this._dry(c, x, z, f.y);
  }

  // Would his knockback along (vx, vz) (a unit) carry him into it: it stands ahead of him within
  // the flight, nearer his way than arm's length (PLAYER_RADIUS + its BUMP_R)?
  _inWay(c, vx, vz) {
    const p = this.player.pos;
    const wx = c.x - p.x;
    const wz = c.z - p.z;
    const r = PLAYER_RADIUS + RIGS[c.kind].BUMP_R * c.scale;
    const ahead = wx * vx + wz * vz;
    const side = wx * vz - wz * vx;
    return ahead > 0 && ahead < SHARED.KNOCK_FAR + r && side * side < r * r;
  }

  // ------------------------------------------------------------------ defeat

  // Does one of his attacks (player.getAttack: { x, y, z, radius }) touch its body? An upright
  // capsule over its feet (a crab's riding its lift); a mosquito's along its body from its tail
  // to the middle of its needle, or to the needle's tip while it dives (a punch into the needle
  // coming at him wins), a little fatter while it is stuck.
  _struck(c, atk) {
    const R = RIGS[c.kind];
    const s = c.scale;
    let r = atk.radius + R.BODY_R * s;
    if (c.kind === MODEL.MOSQUITO) {
      const front = c.state === 'dive' ? R.NEEDLE_TIP : R.NEEDLE_MID;
      if (c.state === 'stuck') r = atk.radius + R.STUCK_R * s;
      this._at(c, R.TAIL[0], R.TAIL[1], R.TAIL[2]);
      const px = _w.x;
      const py = _w.y;
      const pz = _w.z;
      this._at(c, front[0], front[1], front[2]);
      const vx = _w.x - px;
      const vy = _w.y - py;
      const vz = _w.z - pz;
      let u = ((atk.x - px) * vx + (atk.y - py) * vy + (atk.z - pz) * vz) / (vx * vx + vy * vy + vz * vz);
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const dx = atk.x - px - vx * u;
      const dy = atk.y - py - vy * u;
      const dz = atk.z - pz - vz * u;
      return dx * dx + dy * dy + dz * dz <= r * r;
    }
    const lo = c.y + R.BODY_LOW * s;
    const hi = c.y + (R.BODY_HIGH + this._rise(c)) * s;
    const cy = atk.y < lo ? lo : atk.y > hi ? hi : atk.y;
    const dx = atk.x - c.x;
    const dy = atk.y - cy;
    const dz = atk.z - c.z;
    return dx * dx + dy * dy + dz * dz <= r * r;
  }

  // Did he come down on its top this tick? (Falling, out of the air, his feet above its top on
  // the previous tick and at or below it now, and no lower than STOMP_LOW under its origin, his
  // feet's axis over it; never knocked back, burnt, dying, dropping in or reading.)
  _stomped(c, player, hero) {
    if (NO_STOMP[player.action] === 1) return false;
    const p = player.pos;
    const vy = player.vel ? player.vel.y : 0;
    if (!(vy < 0 || (hero !== null && hero.vy < 0))) return false;
    if (hero !== null && !hero.air) return false;
    const R = RIGS[c.kind];
    const top = c.y + (R.TOP + this._rise(c)) * c.scale;
    const prevY = hero !== null ? hero.y : p.y - vy;
    if (prevY < top - 20 || p.y > top + 25 || p.y < c.y - SHARED.STOMP_LOW * c.scale) return false;
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const r = PLAYER_RADIUS + R.STOMP_REACH * c.scale;
    return dx * dx + dz * dz <= r * r;
  }

  // How far (rig units) a crab's body rides up or down on its legs from standing (its lift and
  // its spot's stand: the lift channel's LIFT_SPAN * (b1 - 1)); 0 for the others.
  _rise(c) {
    return c.kind === MODEL.CRAB ? CRITTER_RIG.crab.LIFT_SPAN * (c.b1 - 1) : 0;
  }

  // The world position of rig point (lx, ly, lz) of it as it stands now (turned by its yaw and
  // pitch about its origin, at its scale), in _w.
  _at(c, lx, ly, lz) {
    const cp = Math.cos(c.pitch);
    const sp = Math.sin(c.pitch);
    const cy = Math.cos(c.yaw);
    const sy = Math.sin(c.yaw);
    const s = c.scale;
    const z1 = ly * sp + lz * cp;
    _w.x = c.x + (lx * cy + z1 * sy) * s;
    _w.y = c.y + (ly * cp - lz * sp) * s;
    _w.z = c.z + (z1 * cy - lx * sy) * s;
    return _w;
  }

  // Stomped or struck (F8): the token back, the marker gone, its kind's defeat.
  _defeat(c, stomped) {
    this._freeToken(c);
    c.markOn = 0;
    c.engaged = 0;
    c.outFor = 0;
    KINDS[c.kind].defeat(this, c, stomped);
  }

  // Knocked away from him at `speed` per tick, up at vy (from right under him: backward). Away
  // from the camera it would fly on behind him, out of sight: then it goes KNOCK_TURN off the
  // camera's line, to whichever side it is already on.
  _knock(c, speed, vy) {
    const p = this.player.pos;
    let ax = c.x - p.x;
    let az = c.z - p.z;
    const len = Math.sqrt(ax * ax + az * az);
    if (len > 1) {
      ax /= len;
      az /= len;
    } else {
      ax = -Math.sin(c.yaw);
      az = -Math.cos(c.yaw);
    }
    if (this.cameraYaw !== null) {
      const lx = Math.sin(this.cameraYaw);
      const lz = Math.cos(this.cameraYaw);
      if (ax * lx + az * lz > 0) {
        // Turned toward the side of it facing away from the camera's line.
        let nx = az;
        let nz = -ax;
        if (nx * lx + nz * lz > 0) {
          nx = -nx;
          nz = -nz;
        }
        const ca = Math.cos(SHARED.KNOCK_TURN);
        const sa = Math.sin(SHARED.KNOCK_TURN);
        const bx = ax * ca + nx * sa;
        az = az * ca + nz * sa;
        ax = bx;
      }
    }
    c.vx = ax * speed;
    c.vz = az * speed;
    c.vy = vy;
  }

  // One tick of a knocked-away tumble (the minions' wreck rules): on over a floor that is not
  // far below (walls push it; the water, deeper than it may wade, and drops stop it), under
  // gravity g, settling on its floor. Stopped at such an edge it glances off along it (its way
  // turned 45, then 90 degrees, either side), still away from him, or else stops there.
  _tumble(c, g) {
    const col = this.collision;
    if (c.vx !== 0 || c.vz !== 0) {
      const p = this.player.pos;
      const d2 = (c.x - p.x) * (c.x - p.x) + (c.z - p.z) * (c.z - p.z);
      let k = 0;
      for (; k < 5; k++) {
        const a = ((k + 1) >> 1) * 0.785 * (k % 2 === 1 ? 1 : -1);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const vx = c.vx * ca + c.vz * sa;
        const vz = c.vz * ca - c.vx * sa;
        const w = col.findWalls(c.x + vx, c.y, c.z + vz, SHARED.WALL_Y, RIGS[c.kind].BUMP_R * c.scale);
        if (k > 0 && (w.x - p.x) * (w.x - p.x) + (w.z - p.z) * (w.z - p.z) <= d2) continue;
        const f = col.findFloor(w.x, c.y + SHARED.STEP_UP, w.z);
        if (!f.surface || f.y <= c.floorY - 160 || !this._dry(c, w.x, w.z, f.y)) continue;
        c.x = w.x;
        c.z = w.z;
        c.vx = vx;
        c.vz = vz;
        c.floorY = f.y;
        c.nx = f.surface.normal.x;
        c.ny = f.surface.normal.y;
        c.nz = f.surface.normal.z;
        break;
      }
      if (k === 5) c.vx = c.vz = 0;
    }
    c.vy -= g;
    c.y += c.vy;
    if (c.y <= c.floorY) {
      c.y = c.floorY;
      c.vy = 0;
      c.vx *= 0.5;
      c.vz *= 0.5;
      if (c.vx * c.vx + c.vz * c.vz < 1) c.vx = c.vz = 0;
    }
  }

  _poof(c) {
    c.state = 'poof';
    c.t = 0;
    c.shrink = c.vis;
  }

  // POOF (its kind's step calls it): it shrinks away (from the size it had) rising a little;
  // then its coin appears (floating over the water at a wading spot) and it is gone.
  _poofStep(c) {
    c.vis = c.shrink * (1 - c.t / SHARED.POOF);
    c.y += SHARED.POOF_RISE;
    if (c.t < SHARED.POOF) return;
    c.vis = 0;
    c.state = 'gone';
    c.dropX = c.x;
    c.dropY = c.floorY;
    c.dropZ = c.z;
    if (this.shadows !== null) this.shadows.hide(this.shadowBase + c.i);
    const col = this.collision;
    const minY = c.wade === 1 && col.waterLevelAt ? col.waterLevelAt(c.x, c.z) + SHARED.WADE_COIN : -Infinity;
    if (this.onCoin) this.onCoin(c.x, c.floorY, c.z, minY);
  }

  // ------------------------------------------------------------------ sounds and sparkles

  // An integer in range [lo, hi], hash-timed on its seed and the life counter (salt: which
  // timer).
  _every(c, range, salt) {
    return range[0] + Math.floor((range[1] - range[0] + 1) * noise(c.seed * 13.7 + this.life * 0.731 + salt * 5.3));
  }

  // A critter sound at it (lifted 60), with a pitch and a flag of the recipe's ('quiet': its
  // softer level, 'deflate': the other defeat); every critter sound but the idle ones plays (a
  // tell, a strike, a defeat) and sets the shared sound gate.
  _sound(c, name, pitch = 1, flag = null) {
    this.lastSfxLife = this.life;
    const e = { name, pos: { x: c.x, y: c.y + 60, z: c.z } };
    if (pitch !== 1) e.pitch = pitch;
    if (flag !== null) e[flag] = 1;
    this.events.emit('sfx', e);
  }

  // An idle call (quiet), skipped while another critter sound is still fresh (SOUND_GAP).
  _idleSound(c, name) {
    if (this.life - this.lastSfxLife < SHARED.SOUND_GAP) return;
    this.lastSfxLife = this.life;
    this.events.emit('sfx', { name, pos: { x: c.x, y: c.y + 60, z: c.z }, quiet: 1 });
  }

  // A white twinkle within `radius` of the point (ox, height, oz) from it (never star-tinted).
  _twinkle(c, radius, height, ox = 0, oz = 0) {
    if (this.sparkles === null) return;
    _pt.x = c.x + ox;
    _pt.y = c.y + height * c.scale;
    _pt.z = c.z + oz;
    this.sparkles.twinkle(_pt, radius, this.tick * FRAME_DT, TINT.petal);
  }

  // A burst of gold sparkles `height` over it (the frog's wreath turning into its coin).
  _burst(c, height) {
    if (this.sparkles === null) return;
    _pt.x = c.x;
    _pt.y = c.y + height;
    _pt.z = c.z;
    this.sparkles.burst(_pt, this.tick * FRAME_DT, TINT.coin, 9);
  }

  // Bits flying off it from `height` up (TINT[tint]), or off the point (ox, oz) from it.
  _clods(c, height, tint, count, ox = 0, oz = 0) {
    if (this.sparkles === null) return;
    _pt.x = c.x + ox;
    _pt.y = c.y + height;
    _pt.z = c.z + oz;
    this.sparkles.clods(_pt, this.tick * FRAME_DT, TINT[tint], count, 0.8);
  }

  // ------------------------------------------------------------------ render

  animate(alpha, clock) {
    const list = this.list;
    const mesh = this._mesh;
    const markers = this._markers;
    const a4 = this.anim.array;
    const b4 = this.anim2.array;
    const shadows = this.shadows;
    const pulse = 0.85 + 0.15 * Math.sin(clock * TAU * 6);
    let n = 0;
    let marks = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.state === 'gone') continue;
      const R = RIGS[c.kind];
      const x = c.px + (c.x - c.px) * alpha;
      const y = c.py + (c.y - c.py) * alpha;
      const z = c.pz + (c.z - c.pz) * alpha;
      const yaw = c.pyaw + wrapAngle(c.yaw - c.pyaw) * alpha;
      const pitch = c.ppitch + (c.pitch - c.ppitch) * alpha;
      const roll = c.proll + (c.roll - c.proll) * alpha;
      const sq = c.psq + (c.sq - c.psq) * alpha;
      const vis = c.pvis + (c.vis - c.pvis) * alpha;
      // A frog's windup shakes it from tick 12 (sideways, the drawing only).
      let shake = 0;
      if (c.state === 'windup' && c.kind === MODEL.FROG && c.t >= 12) shake = 2 * Math.sin(clock * 61 + c.seed);
      const s = c.scale * vis;
      const sy = s * sq;
      const sxz = s * (1 + (1 - sq) * R.SQUASH_XZ);
      const pv = R.PIVOT * sy;
      _e.set(pitch, yaw, roll, 'YXZ');
      _q.setFromEuler(_e);
      _o.set(0, pv, 0).applyQuaternion(_q);
      _p.set(x + Math.cos(yaw) * shake - _o.x, y + pv - _o.y, z - Math.sin(yaw) * shake - _o.z);
      _m.compose(_p, _q, _s.set(sxz, sy, sxz));
      mesh.setMatrixAt(n, _m);
      a4[n * 4] = c.pa0 + (c.a0 - c.pa0) * alpha;
      a4[n * 4 + 1] = c.pa1 + (c.a1 - c.pa1) * alpha;
      a4[n * 4 + 2] = c.pa2 + (c.a2 - c.pa2) * alpha;
      a4[n * 4 + 3] = c.pa3 + (c.a3 - c.pa3) * alpha;
      b4[n * 4] = c.pb0 + (c.b0 - c.pb0) * alpha;
      b4[n * 4 + 1] = c.pb1 + (c.b1 - c.pb1) * alpha;
      b4[n * 4 + 2] = c.pglow + (c.glow - c.pglow) * alpha;
      b4[n * 4 + 3] = c.kind;
      n++;
      // Its blob shadow on its floor.
      if (shadows !== null) {
        _n.x = c.nx;
        _n.y = c.ny;
        _n.z = c.nz;
        const h = y - c.floorY;
        shadows.place(this.shadowBase + c.i, x, c.floorY, z, _n, shadowSize(R.SHADOW * s, h > 0 ? h : 0));
      }
      // The danger ring where its strike lands, growing toward the strike, pulsing orange (an sRGB
      // orange that stays bright through the pulse: dimmed further it turns brown on the grass);
      // at its brightest, unpulsed, for the first MARK_STEADY of its growth (the moment it shows).
      if (c.markOn === 1) {
        const k = c.pmark + (c.mark - c.pmark) * alpha;
        const N = NUMBERS[c.kind];
        const size = N.MARK_FROM + (N.MARK_TO - N.MARK_FROM) * (k > 1 ? 1 : k);
        const glow = k < MARK_STEADY ? 1 : pulse;
        _q.setFromUnitVectors(UP, _v.set(c.mnx, c.mny, c.mnz));
        _m.compose(_p.set(c.tx, c.markY + 3, c.tz), _q, _s.set(size, 1, size));
        markers.setMatrixAt(marks, _m);
        markers.setColorAt(marks, _col.setRGB(glow, 0.45 * glow, 0.08 * glow, THREE.SRGBColorSpace));
        marks++;
      }
    }
    mesh.count = n;
    mesh.visible = n > 0;
    if (n > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      this.anim.needsUpdate = true;
      this.anim2.needsUpdate = true;
    }
    markers.count = marks;
    markers.visible = marks > 0;
    if (marks > 0) {
      markers.instanceMatrix.needsUpdate = true;
      markers.instanceColor.needsUpdate = true;
    }
  }
}

// (Registered as its chunk loads, skerries: ObjectManager makes a course's critters from
// objects/kinds.js.)
OBJECT_KINDS.Critters = Critters;
