// STOMPWATT, Sparrow Lane's boss (the lane's lazy chunk: objects/laneBoss/index.js attaches it):
// the dad's car, woken by Jonas, stands up into a chunky, cheeky robot made of its own panels
// (docs/ARCHITECTURE.md "STOMPWATT"). B2: it wakes, transforms, stands and watches him (its
// head following him, its eyes blinking, turning on the spot to face him, now and then a wave, a
// flex or a look round), shoos him off its parking spot with a horn honk, and folds back into
// the car and parks after a while or when he has gone; harmless (it never hurts, he cannot walk
// through it).
//
//   new LaneBoss({ objects, area, layout })   objects: the lane's ObjectManager (events,
//       sparkles, view), area: world/area.js's Area (its collision, the named colliders, the
//       classic part's hide range), layout: lane/layout.js
//   boss.update(player, tick, hold)   30 Hz, after the player's tick (hold: a dialog or a warp)
//   boss.animate(alpha)               per frame: both looks' rigs posed between the last two ticks
//   boss.setLook(part | null)         the realistic part shown (its model built then; its hide
//                                     range), or the classic look again
//   boss.reset()                      a new game: parked at once, its first wake's intro again
//   boss.enter()                      an arrival: parked at once
//   boss.state                        'parked' | 'notice' | 'wake' | 'show' | 'home' | 'shoo' |
//                                     'unmorph' | 'settle' (| 'pose': posed by hand, pose())
//   boss.cinematic                    the intro holds Jonas (main: a neutral controller)
//   boss.camera                       its camera overlay (camera.js; main hands it to the camera)
//   boss.pose({ m, pose, yaw, ... })  posed by hand (previews, shots, tests): see there
//   boss.cur                          this tick's pose state (rig.js / model.js Rig.pose)
//
// Waking (layout.LANE_BOSS.wake): Jonas on the drive's level (his feet within `level` of its
// ground), on the ground, within `r` of the car's middle for `dwell` ticks, or touching it (his
// feet against its sides, or his attack on it); never while he is up on the bins, the carport or
// a roof, on the car itself, away (Critters.js AWAY: reading, on a pole or a ledge, ...), blinking
// after a hit, in a dialog or a warp; and once it has parked again, not until he has been REARM
// away from it (so he may climb the car). From `notice` its T lights blink at him now and then
// with a soft chirp. Its first wake of a game is an intro (150 ticks: Jonas held, the camera's
// own, its name card); later wakes are quick (60 ticks).
//
// The car's collider (named dad_ev: lane/props.js) is parked under the world (moveSurfaces) from
// the wake's first tick until the car has settled back on its wheels, then put back exactly
// where it was; if he stands where the car settles, he is lifted onto it. The parked car is
// drawn by the street's own meshes (hidden by their draw range while the robot is up: area part
// .hide.dad_ev); the robot's car form is exactly those triangles, so the swap never shows.
//
// Deterministic (no Math.random, no clock): its idle moves and blinks come from a hash of the
// tick. Allocation: none per tick or frame on its hot paths but event payloads.

import { PLAYER_RADIUS } from '../../core/constants.js';
import { moveSurfaces } from '../../collision/CollisionWorld.js';
import { AWAY } from '../Critters.js';
import { heroInvincible } from '../Minions.js';
import { TINT } from '../Sparkles.js';
import { BlobShadows } from '../BlobShadows.js';
import { BOSS } from './tuning.js';
import { BONES, BONE, POSES, STEP_UP, ATTACH, arrive, unfold } from './rig.js';
import { RobotModel, classicCar } from './model.js';
import { LaneBossCam } from './camera.js';
import { BOSS_CARD } from '../../ui/hudLogic.js';

const N = BONES.length;
const INDEX = Object.fromEntries(BONES.map(([name], i) => [name, i]));
const poseArray = (name) => {
  const a = new Float32Array(N * 3);
  for (const [bone, t] of Object.entries(POSES[name])) a.set(t, INDEX[bone] * 3);
  return a;
};
const POSE = Object.fromEntries(Object.keys(POSES).map((name) => [name, poseArray(name)]));
const MOVERS = Object.keys(ATTACH);
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const wrap = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
// Cheap deterministic noise in 0 .. 1 (as the critters').
const noise = (n) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
// The pitch of each piece's clunk as it locks in (big pieces lower).
const CLUNK = { core: 0.7, tail: 0.75, canopy: 0.72, head: 0.8, doorFL: 0.95, doorFR: 1, doorRL: 1.05, doorRR: 1.1, wheelFL: 1.2, wheelFR: 1.25, wheelRL: 1.15, wheelRR: 1.18 };
const IDLES = ['wave', 'flex', 'hips', 'hips'];
const CONTACT_GONE = 0.25; // (the realistic car's contact shadow hidden this far into the morph)
const BLOB = 230; // (the classic look's shadow under each foot, across)
const UP = { x: 0, y: 1, z: 0 };
// A step's legs (hip, knee, ankle) and their turns about x at its top.
const LEG_L = [INDEX.hipL, INDEX.knL, INDEX.anL];
const LEG_R = [INDEX.hipR, INDEX.knR, INDEX.anR];
const STEP_X = [STEP_UP.hip[0], STEP_UP.kn[0], STEP_UP.an[0]];

function makeState() {
  return { x: 0, y: 0, z: 0, yaw: 0, m: 0, lift: 0, bob: 0, turns: new Float32Array(N * 3), blinkL: 0, blinkR: 0, hatch: 0 };
}

export class LaneBoss {
  constructor({ objects, area, layout }) {
    this.objects = objects;
    this.events = objects.events;
    this.collision = area.collision;
    this.layout = layout;
    const spec = layout.LANE_BOSS;
    this.spec = spec;
    const car = layout.CARS.find((c) => c.id === spec.car);
    this.car = car;
    const K = layout.CAR_KINDS[car.kind];
    this.hw = K.w / 2;
    this.hl = K.l / 2;
    this.top = K.roof;
    const o = area.objectsLayout.ORIGIN ?? { x: 0, y: 0, z: 0 };
    this.spot = { x: car.x + o.x, y: layout.groundHeight(car.x, car.z) + o.y, z: car.z + o.z }; // (its ground: the drive)
    this.yaw0 = car.yaw;
    const named = area.objectsLayout.NAMED?.[spec.car];
    if (!named) throw new Error(`LaneBoss: no collider named ${spec.car}`);
    this.named = named;
    this.carSurfaces = new Set(named.surfaces);
    // The parked car's faces in the street's meshes (hidden while it is up): the classic part's,
    // and the realistic part's once shown.
    this.hides = []; // [{ mesh, first }] of every part it was shown in (both looks')
    this.parts = new Set();
    for (const part of area.parts) this._hideRange(part);
    this.real = null;
    // The models: the classic one now (its programs warmed ahead), the realistic one once its
    // part is shown.
    this.group = objects.group;
    this.classic = new RobotModel('classic', classicCar(layout, area.parts[0]), { tint: car.classicTint ?? car.tint, light: area.parts[0].light, hl: this.hl });
    this.classic.group.visible = false;
    this.group.add(this.classic.group);
    objects.view?.prewarm?.(this.classic.group);
    this.realModel = null;
    this.models = [this.classic];
    // (The classic look's: a blob shadow under each foot, the realistic look's are the sun's.)
    this.blobs = new BlobShadows(2);
    this.blobs.mesh.visible = false;
    this.blobs.mesh.name = 'lane-boss-shadows';
    this.group.add(this.blobs.mesh);
    this.camera = new LaneBossCam();
    this.prev = makeState();
    this.cur = makeState();
    this.draw = makeState();
    this.ease = new Float32Array(N * 3); // the frame's turns, easing toward the goal pose
    this.goal = POSE.stand;
    this._parkNow();
    this.introDone = false;
    this.armed = true;
    this.look = 0; // (its head turned toward him, round, down, tilted)
    this.lookUp = 0;
    this.tilt = 0;
    this.warm = false;
    this.blinkT = 0;
    this.turning = false;
    this.stepT = 0;
    this.idle = null;
  }

  // ---------------------------------------------------------------- looks

  _hideRange(part) {
    if (this.parts.has(part)) return;
    this.parts.add(part);
    for (const [name, first] of Object.entries(part?.hide?.[this.spec.car] ?? {})) {
      const mesh = part.object3D.getObjectByName(name);
      // (The realistic contact shadow stays under the car until it parts: the model has none.)
      if (mesh) this.hides.push({ mesh, first, contact: name.endsWith('-contact') });
    }
  }

  setLook(part) {
    this.real = part;
    if (part) {
      this._hideRange(part);
      if (!this.realModel && part.robot) {
        const tier = part.robot.tier;
        this.realModel = new RobotModel(tier, part.robot, { tint: this.car.tint, hl: this.hl });
        this.realModel.group.visible = false;
        this.group.add(this.realModel.group);
        this.models.push(this.realModel);
        this.warm = true; // (its programs compiled as the look draws, on the next frame: _warm)
      }
    }
    this._show(this.shown);
  }

  // The robot (its skinned meshes, the current look's) shown and the parked car hidden, or back.
  // (A realistic look with no model of it yet keeps the parked car.)
  _show(on) {
    this.shown = on;
    const model = this.real ? this.realModel : this.classic;
    const vis = on && model !== null;
    this.classic.group.visible = vis && model === this.classic;
    if (this.realModel) this.realModel.group.visible = vis && model === this.realModel;
    const list = this.hides;
    const parted = this.cur.m > CONTACT_GONE;
    this.parted = parted;
    for (let i = 0; i < list.length; i++) list[i].mesh.geometry.drawRange.count = vis && (parted || !list[i].contact) ? list[i].first : Infinity;
  }

  // The car's collider parked under the world (the robot is up) or back where it was, exactly.
  _collider(parked) {
    if (this.colliderParked === parked) return;
    this.colliderParked = parked;
    moveSurfaces(this.named.surfaces, this.named.rest, 0, parked ? BOSS.PARK : 0, 0);
  }

  // ---------------------------------------------------------------- states

  get cinematic() {
    return this.state === 'wake' && this.intro;
  }

  _set(state) {
    this.state = state;
    this.t = 0;
  }

  // Parked at once (an arrival, a new game, construction): the car on its spot, its collider in
  // place, the robot hidden.
  _parkNow() {
    const c = this.cur;
    c.x = this.spot.x;
    c.y = this.spot.y;
    c.z = this.spot.z;
    c.yaw = this.yaw0;
    c.m = 0;
    c.lift = 0;
    c.bob = 0;
    c.blinkL = c.blinkR = 0;
    c.hatch = 0;
    c.turns.set(POSE.fold);
    this.ease.set(POSE.stand);
    this.goal = POSE.stand;
    this._copy(this.prev, c);
    this._set('parked');
    this.dwell = 0;
    this.lastNotice = -Infinity;
    this.intro = false;
    this.leave = false;
    this.lifting = false;
    this.camera.reset();
    this._collider(false);
    this._show(false);
  }

  reset() {
    this._parkNow();
    this.introDone = false;
    this.armed = true;
  }

  enter() {
    this._parkNow();
    this.armed = true;
  }

  _emit(phase) {
    const s = this.spot;
    this.events.emit('laneBoss', { phase, pos: { x: s.x, y: s.y, z: s.z } });
  }

  _sfx(name, extra = null) {
    const c = this.cur;
    this.events.emit('sfx', extra ? { name, pos: { x: c.x, y: c.y + 200, z: c.z }, ...extra } : { name, pos: { x: c.x, y: c.y + 200, z: c.z } });
  }

  // Jonas in the car's own frame (u across, w along), and how he stands toward it.
  _read(player, hold) {
    const p = player.pos;
    const s = this.spot;
    const dx = p.x - s.x;
    const dz = p.z - s.z;
    const c = Math.cos(this.yaw0);
    const sn = Math.sin(this.yaw0);
    this.u = dx * c - dz * sn;
    this.w = dx * sn + dz * c;
    this.dist = Math.sqrt(dx * dx + dz * dz);
    this.dx = dx;
    this.dz = dz;
    const f = player.floor;
    this.grounded = !!(f && f.surface) && p.y <= f.y + 1;
    this.onCar = this.grounded && this.carSurfaces.has(f.surface);
    this.level = Math.abs(p.y - s.y) <= this.spec.wake.level;
    this.away = hold || AWAY[player.action] === 1 || heroInvincible(player);
  }

  // Touching the parked car: his feet against its sides (on its level), or his attack on it.
  _touching(player) {
    const r = PLAYER_RADIUS + 6;
    if (this.grounded && this.level && Math.abs(this.u) < this.hw + r && Math.abs(this.w) < this.hl + r) return true;
    const a = player.getAttack?.();
    if (!a || !(a.radius > 0)) return false;
    const s = this.spot;
    const c = Math.cos(this.yaw0);
    const sn = Math.sin(this.yaw0);
    const ax = a.x - s.x;
    const az = a.z - s.z;
    const u = Math.abs(ax * c - az * sn) - this.hw;
    const w = Math.abs(ax * sn + az * c) - this.hl;
    const y = a.y - s.y;
    const dy = y < 0 ? -y : y > this.top ? y - this.top : 0;
    const du = u > 0 ? u : 0;
    const dw = w > 0 ? w : 0;
    return du * du + dw * dw + dy * dy <= a.radius * a.radius;
  }

  update(player, tick, hold = false) {
    this.tick = tick;
    this._copy(this.prev, this.cur);
    if (this.state === 'pose') return;
    this._read(player, hold);
    // A lost life: it goes home (folds back) once it is up.
    if (player.action === 'spawn' && this.lastAction !== 'spawn' && this.state !== 'parked' && this.state !== 'notice') this.leave = true;
    this.lastAction = player.action;
    if (!this.armed && this.dist > BOSS.REARM) this.armed = true;
    this.t++;
    switch (this.state) {
      case 'parked':
      case 'notice':
        this._parked(player);
        break;
      case 'wake':
        this._wake();
        break;
      case 'show':
        this._showing(player);
        break;
      case 'home':
        this._home(player);
        break;
      case 'shoo':
        this._shoo();
        break;
      case 'unmorph':
        this._unmorph();
        break;
      case 'settle':
        this._settle(player);
        break;
    }
    this.camera.tick();
    this._frame();
    if (this.shown && this.cur.m > CONTACT_GONE !== this.parted) this._show(true);
    if (this.state !== 'parked' && this.state !== 'notice') this._bump(player);
  }

  _parked(player) {
    const W = this.spec.wake;
    const ok = this.armed && !this.away && this.level && this.grounded && !this.onCar;
    this.dwell = ok && this.dist < W.r ? this.dwell + 1 : 0;
    if (ok && (this.dwell >= W.dwell || this._touching(player))) {
      this._startWake();
      return;
    }
    // Its notice: the T lights blink at him (the robot's car form shown for a moment: the same
    // faces), a soft chirp.
    const c = this.cur;
    if (this.state === 'notice') {
      const k = this.t;
      c.blinkL = c.blinkR = k >= 3 && k <= 6 ? 1 : 0;
      if (k >= 10) {
        this._set('parked');
        this._show(false);
      }
      return;
    }
    if (this.dist < this.spec.notice && this.level && !this.away && this.tick - this.lastNotice >= BOSS.NOTICE_EVERY) {
      this.lastNotice = this.tick;
      this._set('notice');
      this._show(true);
      this._sfx('ev_chirp', { quiet: 1 });
    }
  }

  _startWake() {
    this.intro = !this.introDone;
    this.phases = this.intro ? BOSS.INTRO : BOSS.QUICK;
    const P = this.phases;
    this.wakeLen = P.BLINK + P.RISE + P.MORPH + P.FLEX;
    this._set('wake');
    this.dwell = 0;
    this.leave = false;
    this.cur.blinkL = this.cur.blinkR = 0;
    this.arrived = 0; // (the pieces locked in so far: a bit each)
    this._collider(true);
    this._show(true);
    this._sfx('ev_chirp');
    if (this.intro) this.camera.intro(this.spot, this.yaw0, this.wakeLen);
    this._emit('wake');
  }

  _wake() {
    const P = this.phases;
    const c = this.cur;
    const t = this.t;
    // The T lights blink (twice in the intro), then it rocks up on its wheels...
    if (t <= P.BLINK) {
      const b = this.intro ? (t >= 2 && t <= 5) || (t >= 10 && t <= 13) : t >= 2 && t <= 5;
      c.blinkL = c.blinkR = b ? 1 : 0;
      return;
    }
    const tr = t - P.BLINK;
    if (tr === 1) {
      this._sfx('robot_power_up');
      this.events.emit('bossImpact', { pos: { x: c.x, y: c.y, z: c.z }, strength: 0.25, kind: 'land' });
      this._sparks(6);
    }
    if (tr <= P.RISE) {
      c.lift = BOSS.LIFT * smooth(tr / P.RISE);
      c.bob = 0;
      return;
    }
    // ...then the morph: the panels fly up on their arcs to their places as the frame unfolds.
    const tm = tr - P.RISE;
    if (tm <= P.MORPH) {
      c.m = tm / P.MORPH;
      this.goal = this.intro ? POSE.flex : POSE.stand;
      this.ease.set(this.goal);
      this._arrivals();
      return;
    }
    // ...it stands tall (the intro: a flex, a horn chord, its name card).
    const tf = tm - P.MORPH;
    c.m = 1;
    if (tf === 1 && this.intro) {
      this._sfx('robot_horn');
      this.events.emit('bossCard', { lines: BOSS_CARD, ms: 2600 });
      this.events.emit('bossImpact', { pos: { x: c.x, y: c.y, z: c.z }, strength: 0.35, kind: 'stomp' });
    }
    if (tf >= P.FLEX) {
      this.introDone = true;
      this.intro = false;
      this._set(this.leave ? 'home' : 'show');
      this.goal = POSE.stand;
      this.showT = 0;
      this.awayT = 0;
      this.nextBlink = this.tick + 40;
      this.nextIdle = this.tick + 60;
      this.idle = null;
      this._emit('show');
    }
  }

  // Each piece locking into place as it arrives: a clunk and a few sparks (the head's last).
  _arrivals() {
    const m = this.cur.m;
    for (let i = 0; i < MOVERS.length; i++) {
      const bit = 1 << i;
      if (this.arrived & bit || arrive(MOVERS[i], m) < 1) continue;
      this.arrived |= bit;
      this._sfx('robot_clunk', { pitch: CLUNK[MOVERS[i]] });
      this._sparks(4, MOVERS[i]);
    }
  }

  // A few white-blue sparks at the robot (or at a piece, on the classic rig's last pose).
  _sparks(n, piece = null) {
    const o = this.objects;
    const c = this.cur;
    const b = piece ? this.classic.rig.bones[BONE[piece]] : null;
    const pos = b ? { x: b.matrixWorld.elements[12], y: b.matrixWorld.elements[13], z: b.matrixWorld.elements[14] } : { x: c.x, y: c.y + 40, z: c.z };
    o.sparkles?.burst(pos, o.time ?? 0, TINT.box, n);
  }

  // Standing: it faces him (turning on the spot, stepping), its head following him, blinking, now
  // and then an idle move; after SHOW, or once he has been away AWAY, or a lost life: home.
  _showing(player) {
    this.showT++;
    const out = this.away || this.dist > BOSS.FAR || !this.level;
    this.awayT = out ? this.awayT + 1 : 0;
    if (this.leave || this.showT >= BOSS.SHOW || this.awayT >= BOSS.AWAY) {
      this._set('home');
      this.idle = null;
      this.goal = POSE.stand;
      return;
    }
    this._face(Math.atan2(this.dx, this.dz), 0.5);
    this._idle();
    void player;
  }

  // Turning toward yaw (when more than `slack` off it), stepping as it turns; true once facing it.
  _face(yaw, slack) {
    const c = this.cur;
    const d = wrap(yaw - c.yaw);
    if (!this.turning && Math.abs(d) > slack) {
      this.turning = true;
      this.stepT = 0;
    }
    if (this.turning) {
      const ad = d < 0 ? -d : d;
      const step = ad < BOSS.TURN ? ad : BOSS.TURN;
      c.yaw = wrap(c.yaw + (d < 0 ? -step : step));
      this.stepT++;
      if (ad < 0.03 && this.stepT % BOSS.STEP === 0) this.turning = false;
      if (this.stepT % BOSS.STEP === 0) this._sfx('robot_step');
    }
    return !this.turning && Math.abs(wrap(yaw - c.yaw)) < 0.03;
  }

  _idle() {
    if (this.tick >= this.nextBlink) {
      this.blinkT = BOSS.BLINK_LEN;
      this.nextBlink = this.tick + Math.round(BOSS.BLINK_EVERY * (0.6 + 0.8 * noise(this.tick)));
    }
    if (this.idle) {
      if (--this.idleT <= 0) {
        this.idle = null;
        this.goal = POSE.stand;
      }
    } else if (this.tick >= this.nextIdle && !this.turning) {
      this.idle = IDLES[Math.floor(noise(this.tick * 3.1) * IDLES.length)];
      this.idleT = this.idle === 'flex' ? 50 : 75;
      this.goal = POSE[this.idle];
      if (this.idle === 'flex') this._sfx('robot_whirr');
      this.nextIdle = this.tick + this.idleT + Math.round(BOSS.IDLE_EVERY * (0.7 + 0.6 * noise(this.tick * 1.7)));
    }
  }

  // Going home: back round to the car's heading, then folding up (or shooing him off its spot).
  _home() {
    if (!this._face(this.yaw0, 0.03)) return;
    if (this._onSpot()) {
      this._set('shoo');
      this.goal = POSE.shoo;
      return;
    }
    this._fold();
  }

  // Jonas where the car will stand (its footprint and a little more).
  _onSpot() {
    const r = PLAYER_RADIUS + 20;
    return Math.abs(this.u) < this.hw + r && Math.abs(this.w) < this.hl + r && this.level;
  }

  _shoo() {
    if (this.t % BOSS.SHOO_EVERY === 1) this._sfx('robot_horn');
    if (!this._onSpot()) this._fold();
    else if (this.t >= BOSS.SHOO_MAX) {
      this.lifting = true;
      this._fold();
    }
  }

  _fold() {
    this._set('unmorph');
    this.goal = POSE.stand;
    this.idle = null;
    this.turning = false;
    this.arrived = 0;
    this._sfx('robot_power_down');
    this._emit('home');
  }

  _unmorph() {
    const c = this.cur;
    c.m = this.t >= BOSS.UNMORPH ? 0 : 1 - this.t / BOSS.UNMORPH;
    c.lift = BOSS.LIFT;
    // (Each piece leaving its place back for the car: a clunk as it drops into the car.)
    for (let i = 0; i < MOVERS.length; i++) {
      const bit = 1 << i;
      if (this.arrived & bit || arrive(MOVERS[i], c.m) > 0) continue;
      this.arrived |= bit;
      this._sfx('robot_clunk', { pitch: CLUNK[MOVERS[i]] * 1.1 });
    }
    if (c.m <= 0) this._set('settle');
  }

  _settle(player) {
    const c = this.cur;
    c.m = 0;
    c.lift = BOSS.LIFT * (1 - smooth(this.t / BOSS.SETTLE));
    if (this.t < BOSS.SETTLE) return;
    c.lift = 0;
    this._sfx('robot_clunk', { pitch: 0.6 });
    this._collider(false);
    // (Standing where the car settled: lifted onto it.)
    if (this._inCar(player)) {
      const p = player.pos;
      const f = this.collision.findFloor(p.x, this.spot.y + this.top + 40, p.z);
      if (f.surface) {
        p.y = f.y;
        if (player.vel) player.vel.y = 0;
      }
    }
    this._set('parked');
    this._show(false);
    this.armed = false;
    this.lifting = false;
    this.leave = false;
    this._sfx('ev_chirp');
    this._emit('parked');
  }

  _inCar(player) {
    const r = PLAYER_RADIUS - 4;
    return Math.abs(this.u) < this.hw + r && Math.abs(this.w) < this.hl + r && player.pos.y < this.spot.y + this.top;
  }

  // The frame's pose this tick: the goal eased into, folded during the morph, its head following
  // him, a step while it turns, blinks.
  _frame() {
    const c = this.cur;
    const e = this.ease;
    const g = this.goal;
    for (let i = 0; i < e.length; i++) e[i] += (g[i] - e[i]) * 0.16;
    const k = unfold(c.m);
    const fold = POSE.fold;
    const t = c.turns;
    for (let i = 0; i < t.length; i++) t[i] = fold[i] + (e[i] - fold[i]) * k;
    if (c.m < 1 || this.state === 'parked' || this.state === 'notice') return;
    // A wave's hand.
    if (this.idle === 'wave') t[INDEX.elL * 3 + 2] += Math.sin(this.tick * 0.45) * 0.35;
    // Stepping round: each foot up and down in turn.
    c.bob = 0;
    if (this.turning) {
      const s = this.stepT % (2 * BOSS.STEP);
      const legs = s < BOSS.STEP ? LEG_L : LEG_R;
      const up = Math.sin((Math.PI * (s % BOSS.STEP)) / BOSS.STEP);
      for (let j = 0; j < 3; j++) t[legs[j] * 3] += STEP_X[j] * up;
      c.bob = -5 * up;
    }
    // Its head following him (a little round and up or down), unless folding up.
    const n = INDEX.neck * 3;
    if (this.state === 'show' || this.state === 'shoo') {
      const L = BOSS.LOOK;
      const rel = wrap(Math.atan2(this.dx, this.dz) - c.yaw);
      const yaw = rel > L.yaw ? L.yaw : rel < -L.yaw ? -L.yaw : rel;
      const pitch = Math.atan2(560, this.dist > 200 ? this.dist : 200) * 0.6;
      this.look = this.look + (yaw - this.look) * 0.15;
      this.lookUp = this.lookUp + ((pitch < L.down ? pitch : L.down) - this.lookUp) * 0.15;
      // (Close by, a curious tilt of its head toward the side he is on.)
      const tilt = this.dist < 650 ? (rel < 0 ? L.tilt : -L.tilt) : 0;
      this.tilt = this.tilt + (tilt - this.tilt) * 0.08;
    } else {
      this.look = this.look * 0.85;
      this.lookUp = this.lookUp * 0.85;
      this.tilt = this.tilt * 0.85;
    }
    t[n + 1] += this.look;
    t[n] += this.lookUp;
    t[n + 2] += this.tilt;
    // Blinks.
    if (this.blinkT > 0) this.blinkT--;
    c.blinkL = c.blinkR = this.blinkT > 0 ? 1 : 0;
  }

  // He cannot walk through it: his feet pushed out of its feet and body (car form: its footprint).
  _bump(player) {
    const c = this.cur;
    const p = player.pos;
    if (p.y > c.y + 690 || p.y < c.y - 60) return;
    const cs = Math.cos(c.yaw);
    const sn = Math.sin(c.yaw);
    const B = BOSS.BUMP;
    if (c.m < 0.35) {
      // (The car rising: its footprint. Folding back it lets him be: standing where it parks he
      // is lifted onto it.)
      if (this.state !== 'wake') return;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const u = dx * cs - dz * sn;
      const w = dx * sn + dz * cs;
      const r = PLAYER_RADIUS;
      const ou = this.hw + r - Math.abs(u);
      const ow = this.hl + r - Math.abs(w);
      if (ou <= 0 || ow <= 0 || p.y > c.y + this.top + c.lift) return;
      let du = 0;
      let dw = 0;
      if (ou < ow) du = (u < 0 ? -1 : 1) * (ou < B.step ? ou : B.step);
      else dw = (w < 0 ? -1 : 1) * (ow < B.step ? ow : B.step);
      p.x += du * cs + dw * sn;
      p.z += -du * sn + dw * cs;
      return;
    }
    this._push(p, c.x, c.z, B.body);
    this._push(p, c.x + 72 * cs + 20 * sn, c.z - 72 * sn + 20 * cs, B.foot);
    this._push(p, c.x - 72 * cs + 20 * sn, c.z + 72 * sn + 20 * cs, B.foot);
  }

  _push(p, x, z, r) {
    const dx = p.x - x;
    const dz = p.z - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const need = r + PLAYER_RADIUS - d;
    if (need <= 0) return;
    const k = (need < BOSS.BUMP.step ? need : BOSS.BUMP.step) / (d || 1);
    p.x += (d ? dx : 1) * k;
    p.z += (d ? dz : 0) * k;
  }

  _copy(to, from) {
    to.x = from.x;
    to.y = from.y;
    to.z = from.z;
    to.yaw = from.yaw;
    to.m = from.m;
    to.lift = from.lift;
    to.bob = from.bob;
    to.turns.set(from.turns);
    to.blinkL = from.blinkL;
    to.blinkR = from.blinkR;
    to.hatch = from.hatch;
  }

  // Its realistic model's programs compiled ahead (in the background where the browser can), once
  // the look is set (the renderer's compileLook): its first wake does not wait for them.
  _warm() {
    const view = this.objects.view;
    if (!view?.look || !view.compileLook) return;
    this.warm = false;
    view.compileLook(view.look, [this.realModel.group]).catch(() => {});
  }

  // Per frame: both looks' rigs (G may swap them any moment) between the last two ticks.
  animate(alpha) {
    if (this.warm) this._warm();
    if (!this.shown) {
      this.blobs.mesh.visible = false;
      return;
    }
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    const p = this.prev;
    const c = this.cur;
    const d = this.draw;
    d.x = p.x + (c.x - p.x) * a;
    d.y = p.y + (c.y - p.y) * a;
    d.z = p.z + (c.z - p.z) * a;
    d.yaw = p.yaw + wrap(c.yaw - p.yaw) * a;
    d.m = p.m + (c.m - p.m) * a;
    d.lift = p.lift + (c.lift - p.lift) * a;
    d.bob = p.bob + (c.bob - p.bob) * a;
    for (let i = 0; i < d.turns.length; i++) d.turns[i] = p.turns[i] + (c.turns[i] - p.turns[i]) * a;
    d.blinkL = c.blinkL;
    d.blinkR = c.blinkR;
    d.hatch = p.hatch + (c.hatch - p.hatch) * a;
    for (let i = 0; i < this.models.length; i++) this.models[i].pose(d);
    // Its feet's blob shadows (the classic look's), as it stands up.
    const feet = this.classic.group.visible && d.m > 0.4;
    this.blobs.mesh.visible = feet;
    if (!feet) return;
    const bones = this.classic.rig.bones;
    const size = (BLOB * (d.m - 0.4)) / 0.6;
    for (let i = 0; i < 2; i++) {
      const e = bones[i ? BONE.anR : BONE.anL].matrixWorld.elements;
      this.blobs.place(i, e[12], this.spot.y, e[14], UP, size);
    }
  }

  // Posed by hand (previews, shots, tests): { m: the morph 0 .. 1, pose: a POSES name, yaw (its
  // heading; default the car's), lift, blink (0 .. 1), look (its head round, radians), hatch };
  // null lets it go (parked at once).
  pose(opts) {
    if (!opts) {
      this._parkNow();
      return;
    }
    const c = this.cur;
    this._set('pose');
    this._collider(true);
    c.m = opts.m ?? 1;
    c.lift = opts.lift ?? (c.m > 0 ? BOSS.LIFT : 0);
    c.yaw = opts.yaw ?? this.yaw0;
    c.blinkL = c.blinkR = opts.blink ?? 0;
    c.hatch = opts.hatch ?? 0;
    c.bob = 0;
    const goal = POSE[opts.pose ?? 'stand'] ?? POSE.stand;
    const k = unfold(c.m);
    for (let i = 0; i < c.turns.length; i++) c.turns[i] = POSE.fold[i] + (goal[i] - POSE.fold[i]) * k;
    c.turns[INDEX.neck * 3 + 1] += opts.look ?? 0;
    this._copy(this.prev, c);
    this._show(true);
    this.animate(1);
  }
}
